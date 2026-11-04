// Two transports behind one interface: p5LiveMedia data channel (peer to peer) and Firebase Realtime DB (fallback).
// Every message, on either transport, is the sender's whole state: {s, t, j, ev}
//   s: sequence, t: sender clock, j: joint angles in jointNames order, ev: events from the last few seconds.
// Events carry ids and are deduped on receipt, so the same code path works for a lossy or a replayed channel.
import { firebaseConfig } from "./config.js";

const SEND_MS = 50;              // 20 Hz
const INTERP_DELAY_MS = 100;     // render the opponent this far in the past
const CONNECTED_MS = 1500;       // opponent counts as connected if heard from this recently
const FALLBACK_AFTER_MS = 8000;  // peer listed but no data channel after this long: WebRTC is probably blocked
const EVENT_KEEP_MS = 3000;
const FLAG_MAX_AGE_MS = 10 * 60 * 1000;
const FB = "https://www.gstatic.com/firebasejs/12.19.0/";

const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement("script");
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.appendChild(s);
});

// ---- transport: p5LiveMedia (data only: no p5 sketch needed) ----
function p5liveTransport(room, hooks) {
  let p5lm = null;
  return {
    name: "p5live",
    async start() {
      const base = "https://p5livemedia.itp.io/";
      await loadScript(`${base}simplepeer.min.js`);
      await loadScript(`${base}socket.io.js`);
      await loadScript(`${base}p5livemedia.js`);
      p5lm = new p5LiveMedia({}, "DATA", null, `so100duel-${room}`); // class declarations are global lexical bindings, not window props
      p5lm.on("data", (data, id) => hooks.message(data, id));
    },
    peersListed: () => p5lm?.simplepeers.length ?? 0,
    debug: () => ({ socket: p5lm?.socket?.connected, peers: p5lm?.simplepeers.map((p) => ({ id: p.socket_id, connected: p.simplepeer?.connected, err: p.simplepeer?.destroyed })) }),
    send(state) { p5lm?.send(JSON.stringify(state)); },
    close() { try { p5lm?.socket.disconnect(); p5lm?.disconnect(); } catch { /* already gone */ } },
  };
}

// ---- transport: Firebase Realtime Database (latest state per player at duels/<room>/<uid>) ----
async function loadFirebase() {
  const [{ initializeApp, getApps, getApp }, auth, db] = await Promise.all([
    import(`${FB}firebase-app.js`), import(`${FB}firebase-auth.js`), import(`${FB}firebase-database.js`),
  ]);
  const app = getApps().some((a) => a.name === "duel") ? getApp("duel") : initializeApp(firebaseConfig, "duel");
  const { user } = await auth.signInAnonymously(auth.getAuth(app));
  return { db, database: db.getDatabase(app), uid: user.uid };
}

function firebaseTransport(room, hooks, tag) {
  let fb = null, mine = null, key = null, snaps = 0, lastError = null, writes = 0;
  return {
    name: "firebase",
    debug: () => ({ uid: fb?.uid, snaps, writes, lastError }),
    async start() {
      fb = await loadFirebase();
      key = `${fb.uid}_${tag}`;           // user id + per-page tag: two tabs of one browser share a uid
      mine = fb.db.ref(fb.database, `duels/${room}/${key}`);
      fb.db.onDisconnect(mine).remove();
      fb.db.onValue(fb.db.ref(fb.database, `duels/${room}`), (snap) => {
        snaps++;
        snap.forEach((child) => { if (child.key !== key) hooks.message(JSON.stringify(child.val()), child.key); });
      });
    },
    peersListed: () => 0,
    send(state) {
      if (!mine) return;
      fb.db.set(mine, state).then(() => writes++, (e) => { lastError = e.message; });
    },
    close() { try { fb?.db.remove(mine); } catch { /* ignore */ } },
  };
}

export function createNet({ room, jointNames, prefer = "p5live" }) {
  const tag = Math.random().toString(36).slice(2, 7);
  const net = {
    room,
    transport: "none",
    status: "connecting…",
    connected: false,
    inHz: 0,
    outHz: 0,
  };

  let tr = null, seq = 0, evSeq = 0, lastSend = 0, lastHeard = -Infinity, opponentId = null;
  let latestJoints = jointNames.map(() => 0);
  let events = [];                  // our recent events, replayed inside every state message
  const seen = new Set();           // event ids already delivered
  const handlers = [];
  let frames = [];                  // opponent frames: {t: receive time, j}
  let inCount = 0, outCount = 0, rateT = performance.now();
  let peerListedAt = null, stopped = false;

  function receive(raw, id) {
    let m;
    try { m = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return; }
    if (!m || !Array.isArray(m.j)) return;
    opponentId = id;                // two players: the most recent sender other than us is the opponent
    const now = performance.now();
    lastHeard = now;
    inCount++;
    frames.push({ t: now, j: m.j });
    if (frames.length > 40) frames.shift();
    for (const ev of m.ev ?? []) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      for (const h of handlers) h(ev);
    }
  }

  function send(force = false) {
    const now = performance.now();
    if (!tr || (!force && now - lastSend < SEND_MS)) return;
    lastSend = now;
    events = events.filter((e) => now - e.at < EVENT_KEEP_MS);
    tr.send({ s: seq++, t: Date.now(), j: latestJoints, ev: events.map(({ id, k, ...rest }) => ({ id, k, ...rest })) });
    outCount++;
  }

  async function use(make) {
    tr?.close();
    frames = [];
    tr = make(room, { message: receive }, tag);
    net.transport = tr.name;
    net.status = `connecting via ${tr.name}…`;
    await tr.start();
    net.status = `${tr.name}: waiting for opponent`;
  }

  // when p5LiveMedia cannot reach the peer (blocked WebRTC), flip both players to Firebase through a flag
  async function fallbackToFirebase(reason) {
    if (stopped || tr?.name === "firebase") return;
    console.warn(`[net] falling back to firebase: ${reason}`);
    try {
      await use(firebaseTransport);
      const { db, database } = await loadFirebase();
      db.set(db.ref(database, `duelFlags/${room}`), { transport: "firebase", at: Date.now() });
    } catch (e) {
      net.status = `network unavailable (${e.message})`;
    }
  }

  async function watchFlag() {
    try {
      const { db, database } = await loadFirebase();
      db.onValue(db.ref(database, `duelFlags/${room}`), (snap) => {
        const f = snap.val();
        if (f?.transport === "firebase" && Date.now() - f.at < FLAG_MAX_AGE_MS && tr?.name !== "firebase") {
          use(firebaseTransport).catch((e) => { net.status = `network unavailable (${e.message})`; });
        }
      });
    } catch { /* Firebase rules not set up yet: p5live only */ }
  }

  setInterval(() => {
    const now = performance.now();
    net.connected = now - lastHeard < CONNECTED_MS;
    if (net.connected) net.status = `${tr.name}: connected`;
    if (now - rateT >= 1000) {
      net.inHz = (inCount * 1000) / (now - rateT);
      net.outHz = (outCount * 1000) / (now - rateT);
      inCount = outCount = 0; rateT = now;
    }
    if (tr?.name === "p5live" && !net.connected && tr.peersListed() > 0) {
      peerListedAt ??= now;
      if (now - peerListedAt > FALLBACK_AFTER_MS) fallbackToFirebase("peer found, no data channel");
    } else peerListedAt = null;
  }, 250);

  // network loop: its own 20 Hz timer, independent of rendering and perception
  setInterval(() => send(true), SEND_MS);
  net.sendJoints = (angles) => { latestJoints = jointNames.map((n) => +angles[n].toFixed(3)); };
  net.sendEvent = (ev) => {
    events.push({ ...ev, id: `${tag}-${evSeq++}`, at: performance.now() });
    send(true);
  };
  net.onEvent = (fn) => handlers.push(fn);

  // the opponent's joints as they were INTERP_DELAY_MS ago, interpolated between buffered frames
  net.sample = (now = performance.now()) => {
    if (!frames.length) return null;
    const target = now - INTERP_DELAY_MS;
    let a = frames[0], b = frames[0];
    for (const f of frames) { if (f.t <= target) a = f; else { b = f; break; } if (f === frames.at(-1)) b = f; }
    const u = b.t > a.t ? Math.min(1, Math.max(0, (target - a.t) / (b.t - a.t))) : 0;
    return Object.fromEntries(jointNames.map((n, i) => [n, a.j[i] + (b.j[i] - a.j[i]) * u]));
  };

  net.debug = () => tr?.debug?.();
  net.close = () => { stopped = true; tr?.close(); };

  (async () => {
    try {
      if (prefer === "firebase") await use(firebaseTransport);
      else { await use(p5liveTransport); watchFlag(); }
    } catch (e) {
      if (prefer === "p5live") fallbackToFirebase(e.message);
      else net.status = `network unavailable (${e.message})`;
    }
  })();

  return net;
}
