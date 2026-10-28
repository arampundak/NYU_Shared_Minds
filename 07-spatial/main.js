import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import URDFLoader from 'urdf-loader';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { TURNS, CONTEXT } from './script.js';

// ---------- palette (mirrors CSS tokens) ----------
const C = {
  ground: 0x0c0f12, grid: 0x1c242b, infra: 0x3a4652, infraHi: 0x9fb0bd,
  authored: 0xf2a33a, live: 0x59cfe3, research: 0xa68cff, memory: 0x7fd6a4, ink: 0xe6ebee,
};
const KIND = { authored: C.authored, live: C.live, research: C.research, memory: C.memory };

// ---------- renderer / scene ----------
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });
labelRenderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(C.ground);
scene.fog = new THREE.Fog(C.ground, 70, 140);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 400);
camera.position.set(-17, 14, 27);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(9, 2.5, 3);
controls.enableDamping = true;
controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
controls.autoRotateSpeed = 0.35;
controls.maxDistance = 120; controls.minDistance = 4;

scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x1a1f24, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-8, 20, 12); scene.add(key);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight);
});

// ---------- helpers ----------
const polar = (r, deg, y = 0) => new THREE.Vector3(r * Math.cos(deg * Math.PI / 180), y, r * Math.sin(deg * Math.PI / 180));
const LABELS = [];
function label(html, cls = '', pos = new THREE.Vector3(), parent = scene) {
  const d = document.createElement('div'); d.className = 'lbl ' + cls; d.innerHTML = html;
  const o = new CSS2DObject(d); o.position.copy(pos); parent.add(o); o.userData.want = true; LABELS.push(o); return o;
}
function syncLabels() {
  for (const o of LABELS) { let v = o.userData.want, p = o.parent; while (v && p) { v = p.visible; p = p.parent; } o.visible = v; }
}
function box(w, h, d, color, opacity = 0.18) {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const fill = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: .6, emissive: color, emissiveIntensity: 0 }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .9 }));
  g.add(fill, edges); g.userData = { fill, edges, baseOpacity: opacity, color: new THREE.Color(color) };
  return g;
}
function setGlow(g, a) { // a: 0..1
  const { fill, edges, baseOpacity } = g.userData;
  if (g.userData.lbl) g.userData.lbl.element.classList.toggle('active', a > .3);
  fill.material.opacity = baseOpacity + a * 0.45;
  fill.material.emissiveIntensity = a * 0.9;
  edges.material.opacity = 0.55 + a * 0.45;
}
function ringLine(r, color, y = 0.01, dashed = false) {
  const pts = []; for (let i = 0; i <= 128; i++) pts.push(polar(r, i / 128 * 360, y));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .6, gapSize: .5 }) : new THREE.LineBasicMaterial({ color });
  const l = new THREE.Line(geo, mat); if (dashed) l.computeLineDistances(); scene.add(l); return l;
}
function wire(a, b, color, lift = 2, dashed = false) {
  const mid = a.clone().add(b).multiplyScalar(.5); mid.y += lift;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
  const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .35, gapSize: .3, transparent: true, opacity: .8 })
                     : new THREE.LineBasicMaterial({ color, transparent: true, opacity: .55 });
  const l = new THREE.Line(geo, mat); if (dashed) l.computeLineDistances(); scene.add(l); return l;
}
const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const pulse = (t, a, b, fade = .35) => (t < a - fade || t > b + fade) ? 0 : (t < a ? 1 - (a - t) / fade : t > b ? 1 - (t - b) / fade : 1);

// Route: chain of arcs through waypoints, sampled by arc length.
class Route {
  constructor(points, lift = 1.5) {
    const pts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const mid = a.clone().add(b).multiplyScalar(.5); mid.y += lift + a.distanceTo(b) * 0.08;
      const seg = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(40);
      if (i) seg.shift(); pts.push(...seg);
    }
    this.pts = pts; this.len = [0];
    for (let i = 1; i < pts.length; i++) this.len.push(this.len[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.total = this.len[this.len.length - 1];
  }
  at(u, out = new THREE.Vector3()) {
    const d = clamp01(u) * this.total; let i = 1;
    while (i < this.len.length - 1 && this.len[i] < d) i++;
    const k = (d - this.len[i - 1]) / Math.max(1e-6, this.len[i] - this.len[i - 1]);
    return out.copy(this.pts[i - 1]).lerp(this.pts[i], k);
  }
}

// ---------- layout (distance from robot = latency, not to scale) ----------
const R_MAC = 8, R_HF = 18, R_AI = 36;
const P = {
  mic: new THREE.Vector3(0, 4.8, 0),
  mac: polar(R_MAC, 0, 0.7),
  motion: polar(5, -62, 0.5),
  vad: polar(R_HF, -26, 0.9), stt: polar(R_HF, -9, 0.9), llm: polar(R_HF, 9, 0.9), tts: polar(R_HF, 26, 0.9),
  voice: polar(R_HF + 3.2, 36, 0.5),
  tower: polar(R_HF + 8, 2, 0),
  ai: polar(R_AI, -52, 11),
  embed: polar(12, 205, 5),
};

// ground grid + latency rings
const grid = new THREE.PolarGridHelper(40, 16, 10, 64, C.grid, C.grid); grid.position.y = -0.02; scene.add(grid);
ringLine(R_MAC, 0x3d4a55); ringLine(R_HF, 0x3d4a55); ringLine(R_AI, 0x3d4a55, 0.01, true);
label('your Mac · same room', 'ring', polar(R_MAC, 90, 0.1));
label('Hugging Face · network hop', 'ring', polar(R_HF, 90, 0.1));
label('OpenAI · seconds away', 'ring', polar(R_AI, -70, 0.1));
label('distance from robot = latency (not to scale)', 'ring', polar(R_HF + 2, 180, 0.1));

// ---------- stations ----------
const stations = {};
function station(id, pos, w, h, d, color, html, cls = '') {
  const g = box(w, h, d, color, 0.12); g.position.copy(pos); scene.add(g);
  g.userData.lbl = label(html, cls + ' quiet', new THREE.Vector3(0, h / 2 + 0.35, 0), g);
  stations[id] = g; return g;
}
station('mac', P.mac, 3, 1.4, 2, C.infraHi, '<b>Conversation app</b><small>Python on the Mac · the switchboard</small>');
station('motion', P.motion, 2, .9, 1.4, C.authored, '<b>Movement code</b><small>breathing · wobble from loudness · gestures</small>', 'authored');
// HF enclosure: one black box reached over one WebSocket
{
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R_HF + 2.4, R_HF + 2.4, 3.2, 64, 1, true, -34 * Math.PI / 180 + Math.PI / 2, 68 * Math.PI / 180),
    new THREE.MeshBasicMaterial({ color: 0x2a3540, transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false }));
  shell.position.y = 1.6; shell.rotation.y = 0; scene.add(shell);
  const inner = shell.clone(); inner.geometry = new THREE.CylinderGeometry(R_HF - 2.4, R_HF - 2.4, 3.2, 64, 1, true, -34 * Math.PI / 180 + Math.PI / 2, 68 * Math.PI / 180); scene.add(inner);
  label('<b>Pollen voice server</b><small>Hugging Face · one black box · hosted models unconfirmed</small>', '', polar(R_HF, -40, 3.8));
}
station('vad', P.vad, 2.2, 1.3, 1.6, C.infraHi, '<b>Voice activity</b><small>likely Silero VAD*</small>');
station('stt', P.stt, 2.2, 1.3, 1.6, C.infraHi, '<b>Speech → text</b><small>likely Parakeet*</small>');
station('llm', P.llm, 2.6, 1.8, 2, C.ink, '<b>Language model</b><small>likely Gemma 4 E4B* · predicts word-pieces</small>');
station('tts', P.tts, 2.2, 1.3, 1.6, C.infraHi, '<b>Text → speech</b><small>Qwen3-TTS voices (confirmed)</small>');
station('voice', P.voice, 1.6, .7, 1.2, C.authored, '<b>Voice setting</b><small>how Ari sounds · the only input TTS gets besides text</small>', 'authored');
station('ai', P.ai, 3.4, 2.2, 2.6, C.research, '<b>Researcher</b><small>OpenAI reasoning model + web search</small>', 'research');

// WebSocket cable
wire(P.mac.clone().setY(1), polar(R_HF - 2.4, 0, 1), 0x5a6a77, .6);
const wsLabel = label('one always-open WebSocket · 16,000 samples/s', 'warn', polar(13, 2, 2.3));

// Wires that show where authored text can reach
wire(P.voice.clone(), P.tts.clone(), C.authored, 1.2);
wire(P.motion.clone().setY(1), new THREE.Vector3(0, 2.6, 0), C.authored, 1.5);
const ttsWarn = label('TTS gets reply text + voice setting · never profile.md', 'warn', polar(R_HF + 1.5, 31, 2.9));

// ---------- context tower ----------
const UNIT = 1 / 330; // tokens -> height
const tower = new THREE.Group(); tower.position.copy(P.tower); scene.add(tower);
const slabs = {};
for (const c of CONTEXT) {
  const g = box(3.6, 1, 2.6, KIND[c.kind], c.kind === 'authored' ? .22 : .2);
  tower.add(g);
  const lb = label(`<b>${c.name}</b><small>${c.sub}</small>`, c.kind + ' quiet', new THREE.Vector3(2.0, 0, 0), g);
  lb.center.set(0, .5);
  g.userData.lbl = lb;
  slabs[c.id] = { g, c, lb };
}
const towerTitle = label('<b>What the LLM reads, every reply</b><small>rebuilt from text each time · it never hears audio, never learns</small>', '', new THREE.Vector3(0, 0, 0), tower);
// persona wire: profile -> LLM only
const profileWirePts = [];
const wireToLLM = {};
for (const id of ['profile', 'doc1', 'rules', 'tools', 'note', 'conv', 'memory']) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const col = KIND[slabs[id].c.kind];
  const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: .25 }));
  scene.add(ln); wireToLLM[id] = ln;
}

// ---------- Mac 24-utterance window ----------
const slots = [];
for (let i = 0; i < 24; i++) {
  const p = polar(2.3, i / 24 * 360, 0).add(P.mac).setY(0.08);
  const m = new THREE.Mesh(new THREE.BoxGeometry(.42, .08, .26), new THREE.MeshStandardMaterial({ color: 0x26313a, emissive: 0x000000 }));
  m.position.copy(p); m.lookAt(P.mac.clone().setY(.08)); scene.add(m); slots.push(m);
}
const winLabel = label('<b>24-utterance window</b><small>0 / 24 · copy kept on the Mac for the researcher</small>', 'live', P.mac.clone().add(new THREE.Vector3(0, -0.5, 3.4)));
const memFile = box(.9, .5, .7, C.memory, .15); memFile.position.copy(polar(R_MAC + 3, -9, .3)); scene.add(memFile);
const memLabel = label('<b>memory file</b><small>0 facts on disk</small>', 'memory', new THREE.Vector3(0, .6, 0), memFile);

// ---------- OpenAI request stack ----------
const aiStack = new THREE.Group(); aiStack.position.copy(P.ai).add(new THREE.Vector3(4.4, -2.2, 0)); scene.add(aiStack);
const AI_PARTS = [
  ['Researcher instructions', 'authored', 300], ['Doc 2 · reasoner playbook', 'authored', 520], ['Doc 1 · shop context (copy)', 'authored', 640],
  ['The question', 'live', 60], ['Last 24 utterances · ≤ 24,000 chars', 'live', 400],
];
{ let y = 0; for (const [n, k, tok] of AI_PARTS) { const h = Math.max(.22, tok * UNIT); const g = box(2.8, h, 2, KIND[k], .25); g.position.y = y + h / 2; y += h + .05; aiStack.add(g); const l = label(`<b>${n}</b>`, k, new THREE.Vector3(1.5, 0, 0), g); l.center.set(0, .5); } }
const aiNever = label('never sees: <s>profile.md</s> <s>memory</s> <s>tool list</s> <s>audio</s>', 'warn', P.ai.clone().add(new THREE.Vector3(4.4, -3.2, 0)));
const aiTimer = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.6, 64, 1, 0, 0.01), new THREE.MeshBasicMaterial({ color: C.research, side: THREE.DoubleSide }));
aiTimer.position.copy(P.ai).add(new THREE.Vector3(0, 0, 1.4)); scene.add(aiTimer);
const aiTimerLabel = label('', 'research', P.ai.clone().add(new THREE.Vector3(0, -2.6, 1.4)));

// ---------- embedding lens (a visualization aid, NOT part of Ari) ----------
const lens = new THREE.Mesh(new THREE.SphereGeometry(3.4, 32, 16), new THREE.MeshBasicMaterial({ color: 0x2a3540, wireframe: true, transparent: true, opacity: .25 }));
lens.position.copy(P.embed); scene.add(lens);
label('<b>Embedding lens</b><small>a view aid · not part of Ari</small>', '', P.embed.clone().add(new THREE.Vector3(0, 4.2, 0)));

// ---------- robot ----------
const robotHolder = new THREE.Group(); scene.add(robotHolder);
const headPivot = new THREE.Group();
let robot = null;
const loader = new URDFLoader();
loader.packages = 'robot';
const stl = new STLLoader();
const meshJobs = [];
let meshData = null;
async function geomFor(name) {
  const bytes = Uint8Array.from(atob(meshData[name]), c => c.charCodeAt(0));
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return stl.parse(buf);
}
loader.loadMeshCb = (path, manager, done) => {
  const name = path.split('/').pop();
  meshJobs.push(geomFor(name).then(g => done(new THREE.Mesh(g, new THREE.MeshStandardMaterial()))).catch(e => done(null, e)));
};
(async () => {
  try {
    const [xml, meshes] = await Promise.all([fetch('robot/reachy_mini.xml').then(r => r.text()), fetch('robot/meshes.json').then(r => r.json())]);
    meshData = meshes;
    const r = loader.parse(xml);
    await Promise.all(meshJobs);
    fitRobot(r);
  } catch (e) { document.getElementById('loading').textContent = 'robot model failed to load'; console.error(e); }
})();
function fitRobot(r) {
  robot = r; r.rotation.x = -Math.PI / 2;
  r.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.roughness = .55; o.material.metalness = .05; } });
  robotHolder.add(r); robotHolder.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(r), size = bb.getSize(new THREE.Vector3());
  const s = 5.4 / size.y; robotHolder.scale.setScalar(s);
  robotHolder.updateMatrixWorld(true);
  const bb2 = new THREE.Box3().setFromObject(r), c = bb2.getCenter(new THREE.Vector3());
  robotHolder.position.x -= c.x; robotHolder.position.z -= c.z; robotHolder.position.y -= bb2.min.y;
  robotHolder.rotation.y = Math.PI; // face away from the stations, toward the student
  robotHolder.updateMatrixWorld(true);
  const head = r.links['xl_330'];
  if (head) {
    const hp = new THREE.Vector3(); head.getWorldPosition(hp);
    robotHolder.add(headPivot); headPivot.position.copy(robotHolder.worldToLocal(hp.clone()));
    headPivot.updateMatrixWorld(true); headPivot.attach(head);
  }
  document.getElementById('loading')?.remove();
}
label('<b>Reachy Mini</b><small>mic + speaker · does not think</small>', '', new THREE.Vector3(0, 6.4, 0));
const student = label('<b>student</b>', 'live', new THREE.Vector3(-4.2, 2, 0));

// ---------- Ari's recorded voice (Qwen3-TTS "Aiden"); falls back to browser speech if the clips are missing ----------
const CLIP_SECONDS = await fetch('audio/durations.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
const clips = TURNS.map((_, i) => CLIP_SECONDS[i] ? new Audio(`audio/ari-${i}.wav`) : null);
clips.forEach(a => { if (a) a.preload = 'auto'; });

// ---------- build the timeline ----------
const W_STUDENT = 2.5, W_ARI = 2.8; // words per second
const words = s => s.split(/\s+/).length;
const tok = s => Math.round(words(s) * 1.35);
const TL = { speech: [], active: {}, streams: [], flyers: [], slotFill: [], conv: [], phases: [], turns: [], embed: [] };
const act = (id, a, b) => (TL.active[id] ||= []).push([a, b]);
const phase = (a, b, text) => TL.phases.push([a, b, text]);

const routes = {
  up: new Route([P.mic, P.mac.clone().setY(1.5), polar(R_HF - 2.4, 0, 1.2), P.vad.clone().setY(1.6)], 1),
  down: new Route([P.tts.clone().setY(1.6), polar(R_HF - 2.4, 0, 1.2), P.mac.clone().setY(1.5), P.mic], 1),
  sttToWin: new Route([P.stt.clone().setY(1.6), P.mac.clone().setY(1.2)], 2),
  llmToWin: new Route([P.llm.clone().setY(1.9), P.mac.clone().setY(1.2)], 2.5),
  vadToStt: new Route([P.vad.clone().setY(1.6), P.stt.clone().setY(1.6)], .6),
  sttToLlm: new Route([P.stt.clone().setY(1.6), P.llm.clone().setY(1.9)], .6),
  llmToTts: new Route([P.llm.clone().setY(1.9), P.tts.clone().setY(1.6)], .6),
  llmToMac: new Route([P.llm.clone().setY(2), P.mac.clone().setY(1.6)], 3),
  macToAi: new Route([P.mac.clone().setY(1.6), P.ai.clone()], 6),
  aiToMac: new Route([P.ai.clone(), P.mac.clone().setY(1.6)], 6),
};
let t = 2.0;
let noteDock = 0, noteGone = 0, research = null, rememberAt = 0, convTokens = 0;
TURNS.forEach((turn, i) => {
  const ts = t, te = ts + words(turn.student) / W_STUDENT + .4;
  TL.turns.push(ts - .8);
  TL.speech.push({ who: 'student', text: turn.student, a: ts, b: te, i });
  act('vad', ts, te + .5);
  TL.streams.push({ route: routes.up, a: ts, b: te, T: 1.6, color: C.live });
  phase(ts, te, 'student speaking · antennas freeze · 16 kHz audio streams up the WebSocket');
  const stop = te + .5;
  phase(te, stop, 'speech_stopped · a short silence ends the turn');
  act('stt', stop, stop + .45);
  TL.flyers.push({ route: routes.vadToStt, a: te + .1, T: .4, text: null, color: C.live });
  phase(stop, stop + .45, 'speech → text · one utterance is born');
  const uBorn = stop + .45;
  TL.flyers.push({ route: routes.sttToWin, a: uBorn, T: 1.1, text: `“${turn.student}”`, color: C.live });
  TL.slotFill.push({ at: uBorn + 1.1, role: 'student' });
  TL.embed.push({ at: uBorn, text: turn.student, role: 'student' });
  TL.flyers.push({ route: routes.sttToLlm, a: uBorn, T: .5, text: null, color: C.live });
  convTokens += tok(turn.student); TL.conv.push({ at: uBorn + .5, tokens: convTokens });
  let llmA = uBorn + .5;
  if (i === 5 && noteDock) llmA = Math.max(llmA, noteDock + .5);
  let llmB = llmA + 1.0;
  TL.speech.push({ who: 'reading', a: llmA, b: llmB, i });
  phase(llmA, llmB, 'language model reads the whole tower, then predicts the reply word-piece by word-piece');

  if (turn.tool === 'research') {
    const call = llmA + .55;
    TL.flyers.push({ route: routes.llmToMac, a: call, T: .9, text: 'research_question(“why charring + partial cut?”)', color: C.research });
    const send = call + .9 + .75;
    act('mac', call + .9, send);
    phase(call, send, 'tool call predicted · the Mac waits 0.75 s, then sends ONE request');
    TL.flyers.push({ route: routes.macToAi, a: send, T: 1.8, text: 'one request: instructions + Doc 2 + Doc 1 + question + last 24 utterances', color: C.research });
    const arrive = send + 1.8, think = 9.5, leave = arrive + think;
    act('ai', arrive, leave);
    research = { send, arrive, leave };
    phase(arrive, leave, 'researcher thinking (45 s timeout) · meanwhile Ari keeps talking');
    TL.flyers.push({ route: routes.aiToMac, a: leave, T: 1.8, text: 'advisory note: ≤2 snippets · next question · uncertainty · sources', color: C.research });
    const back = leave + 1.8; act('mac', back, back + .4);
    noteDock = back + 1.0;
    TL.flyers.push({ route: new Route([P.mac.clone().setY(1.6), P.tower.clone().setY(5)], 3), a: back, T: 1.0, text: 'session.update', color: C.research });
    phase(back, noteDock, 'the Mac pastes the note into the instructions (session.update)');
  }
  if (turn.tool === 'remember') {
    const call = llmA + .5; rememberAt = call + .9;
    TL.flyers.push({ route: routes.llmToMac, a: call, T: .9, text: 'remember(“working on the lamp project”)', color: C.memory });
    act('mac', rememberAt, rememberAt + .5);
  }
  act('llm', llmA, llmB);
  const replyA = llmB; // reply text exists (streams)
  const sa = replyA + .45, sb = sa + (CLIP_SECONDS[i] ?? words(turn.ari) / W_ARI) + .3;
  act('llm', replyA, replyA + .3);
  act('tts', replyA, sb - .3);
  TL.flyers.push({ route: routes.llmToTts, a: replyA, T: .35, text: null, color: C.live });
  TL.flyers.push({ route: routes.llmToWin, a: replyA + .2, T: 1.2, text: `“${turn.ari}”`, color: C.authored });
  TL.slotFill.push({ at: replyA + 1.4, role: 'ari' });
  TL.embed.push({ at: replyA + .2, text: turn.ari, role: 'ari' });
  convTokens += tok(turn.ari); TL.conv.push({ at: replyA + .3, tokens: convTokens });
  TL.streams.push({ route: routes.down, a: replyA + .1, b: sb - .45, T: 1.6, color: C.authored });
  TL.speech.push({ who: 'ari', text: turn.ari, a: sa, b: sb, i, lights: turn.lights });
  phase(replyA, sb, 'text → speech in the chosen voice, streamed while still generating · head wobbles from loudness');
  if (i === 5) noteGone = sb;
  t = sb + 1.7;
});
const END = t + 1.5;
const speeches = TL.speech;
const readWindows = TURNS.map((_, i) => {
  const r = speeches.find(s => s.who === 'reading' && s.i === i), a = speeches.find(s => s.who === 'ari' && s.i === i);
  return [r.a, a.b];
});

// ---------- packets (instanced) ----------
const PK_MAX = 400;
const pk = new THREE.InstancedMesh(new THREE.BoxGeometry(.12, .12, .12), new THREE.MeshBasicMaterial({ color: 0xffffff }), PK_MAX);
pk.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(pk);
const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpC = new THREE.Color();

// ---------- flyers ----------
for (const f of TL.flyers) {
  const big = !!f.text;
  const m = new THREE.Mesh(big ? new THREE.BoxGeometry(.9, .12, .6) : new THREE.SphereGeometry(.16, 12, 8),
    new THREE.MeshBasicMaterial({ color: f.color }));
  m.visible = false; scene.add(m); f.mesh = m;
  if (big) { f.lbl = label(f.text.length > 70 ? f.text.slice(0, 68) + '…”' : f.text, 'fly', new THREE.Vector3(0, .5, 0), m); f.lbl.visible = false; }
}

// ---------- embedding: TF-IDF + PCA ----------
const embPts = (() => {
  const docs = TL.embed.map(e => e.text.toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(w => w.length > 2));
  const vocab = [...new Set(docs.flat())];
  const df = vocab.map(w => docs.filter(d => d.includes(w)).length);
  let X = docs.map(d => vocab.map((w, j) => (d.filter(x => x === w).length / Math.max(1, d.length)) * Math.log((docs.length + 1) / (df[j] + .5))));
  X = X.map(r => { const n = Math.hypot(...r) || 1; return r.map(v => v / n); });
  const mean = vocab.map((_, j) => X.reduce((s, r) => s + r[j], 0) / X.length);
  X = X.map(r => r.map((v, j) => v - mean[j]));
  const n = X.length, G = X.map(a => X.map(b => a.reduce((s, v, j) => s + v * b[j], 0)));
  const comps = [];
  for (let k = 0; k < 3; k++) {
    let v = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7 + k * 3.1) + .1);
    for (let it = 0; it < 200; it++) {
      let w = G.map(row => row.reduce((s, g, j) => s + g * v[j], 0));
      for (const c of comps) { const d = w.reduce((s, x, j) => s + x * c[j], 0); w = w.map((x, j) => x - d * c[j]); }
      const nn = Math.hypot(...w) || 1; v = w.map(x => x / nn);
    }
    comps.push(v);
  }
  const pts = TL.embed.map((_, i) => new THREE.Vector3(comps[0][i], comps[1][i], comps[2][i]));
  const maxR = Math.max(...pts.map(p => p.length())) || 1;
  return pts.map(p => p.multiplyScalar(3.0 / maxR));
})();
const embMeshes = TL.embed.map((e, i) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(.17, 12, 8), new THREE.MeshBasicMaterial({ color: e.role === 'ari' ? C.authored : C.live }));
  m.position.copy(P.embed).add(embPts[i]); m.visible = false; scene.add(m); return m;
});
const embLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(embMeshes.map(m => m.position)), new THREE.LineBasicMaterial({ color: 0x55636e, transparent: true, opacity: .5 }));
scene.add(embLine);

// ---------- UI ----------
const $ = id => document.getElementById(id);
const ui = { play: $('play'), scrub: $('scrub'), clock: $('clock'), speed: $('speed'), cam: $('cam'), sound: $('sound'), status: $('status'), caption: $('caption'), readTitle: $('readTitle'), readBody: $('readBody'), turns: $('turns') };
let T = 0, playing = false, last = performance.now();
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
ui.play.onclick = () => { if (T >= END) T = 0; playing = !playing; ui.play.textContent = playing ? 'Pause' : 'Play'; };
ui.scrub.oninput = () => { T = ui.scrub.value / 1000 * END; };
addEventListener('keydown', e => { if (e.code === 'Space' && e.target.tagName !== 'BUTTON') { e.preventDefault(); ui.play.click(); } });
TURNS.forEach((tn, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = tn.title; b.onclick = () => { T = TL.turns[i]; }; ui.turns.appendChild(b); });
const turnBtns = [...ui.turns.children];
let lastRead = -2, lastCap = '';

// ---------- sound: browser speech synthesis, one voice per speaker ----------
// Lines start when the timeline reaches them; scrubbing, pausing or leaving a line cancels the speech.
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let soundOn = true, spokenLine = null, voices = [];
const loadVoices = () => { voices = synth ? synth.getVoices().filter(v => /^en/i.test(v.lang)) : []; };
if (synth) { loadVoices(); synth.addEventListener?.('voiceschanged', loadVoices); }
const pickVoice = (who) => {
  const want = who === 'ari' ? /samantha|karen|moira|serena|zira|aria|jenny|female/i : /daniel|alex|fred|david|mark|guy|male/i;
  return voices.find(v => want.test(v.name)) || voices[who === 'ari' ? 0 : Math.min(1, voices.length - 1)] || null;
};
function stopSpeech() { spokenLine = null; if (synth) synth.cancel(); clips.forEach(a => { if (a && !a.paused) a.pause(); }); }
function syncSpeech() {
  if (!soundOn || !playing) { if (spokenLine) stopSpeech(); return; }
  const line = speeches.find(s => s.who !== 'reading' && T >= s.a && T <= s.b);
  if (line === spokenLine) return;
  stopSpeech();
  // Only start a line near its beginning, so a scrub into the middle stays silent instead of speaking late.
  if (!line || T - line.a > .6) return;
  const clip = line.who === 'ari' ? clips[line.i] : null;
  if (clip) { clip.currentTime = 0; clip.playbackRate = Math.min(2, Math.max(.5, +ui.speed.value)); clip.play().catch(() => {}); spokenLine = line; return; }
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(line.text);
  const v = pickVoice(line.who); if (v) u.voice = v;
  u.rate = Math.min(2, Math.max(.6, +ui.speed.value));
  u.pitch = line.who === 'ari' ? 1.1 : .9;
  spokenLine = line; synth.speak(u);
}
ui.sound.onclick = () => {
  soundOn = !soundOn; ui.sound.textContent = soundOn ? 'Sound on' : 'Sound off'; ui.sound.setAttribute('aria-pressed', soundOn);
  if (!soundOn) stopSpeech();
};
if (!synth && !clips.some(Boolean)) { ui.sound.textContent = 'No sound in this browser'; ui.sound.disabled = true; }

function updateUI() {
  ui.scrub.value = Math.round(T / END * 1000);
  ui.clock.textContent = `${fmt(T)} / ${fmt(END)}`;
  const ph = TL.phases.filter(p => T >= p[0] && T <= p[1]).pop();
  ui.status.textContent = ph ? ph[2] : (research && T > research.arrive && T < research.leave ? 'researcher thinking in the background' : 'idle · breathing');
  // caption
  const sp = speeches.filter(s => s.who !== 'reading' && T >= s.a - .05 && T <= s.b + 1.0).pop();
  let html;
  if (sp) {
    const w = sp.text.split(' '), k = Math.max(1, Math.ceil(clamp01((T - sp.a) / (sp.b - sp.a - .3)) * w.length));
    html = sp.who === 'ari'
      ? `<span class="who ari">Ari</span>${w.slice(0, k).join(' ')}<span class="tag">sample reply</span>`
      : `<span class="who">Student</span>${w.slice(0, k).join(' ')}`;
  } else if (T < 1.5) html = '<span class="who">ready</span>Eight turns, about two and a half minutes. Press play.';
  else { const prev = speeches.filter(s => s.who !== 'reading' && T > s.b).pop(); html = prev ? (prev.who === 'ari' ? `<span class="who ari">Ari</span>${prev.text}<span class="tag">sample reply</span>` : `<span class="who">Student</span>${prev.text}`) : lastCap; }
  if (html !== lastCap) { ui.caption.innerHTML = html; lastCap = html; }
  // read panel
  const cur = readWindows.findLastIndex(([a]) => T >= a - .2);
  if (cur !== lastRead) {
    lastRead = cur;
    if (cur < 0) { ui.readTitle.textContent = 'Press play'; }
    else {
      const tn = TURNS[cur]; ui.readTitle.textContent = tn.title;
      ui.readBody.innerHTML = tn.reads.map(r => `<div class="q ${r.k === 'authored' ? '' : r.k}"><span class="src">${r.src}</span>${r.q}</div>`).join('') + (tn.note ? `<p class="none">${tn.note}</p>` : '');
    }
  }
  const ti = TL.turns.findLastIndex(x => T >= x);
  turnBtns.forEach((b, i) => b.classList.toggle('on', i === ti));
}

// ---------- per-frame scene state = f(T) ----------
function frame(time) {
  const now = performance.now(), dt = Math.min(.1, (now - last) / 1000); last = now;
  if (playing) { T += dt * +ui.speed.value; if (T >= END) { T = END; playing = false; ui.play.textContent = 'Replay'; } }

  // stations
  for (const [id, g] of Object.entries(stations)) {
    let a = 0; for (const [s, e] of TL.active[id] || []) a = Math.max(a, pulse(T, s, e));
    setGlow(g, a);
  }
  // TTS lit by voice setting, motion lit while Ari speaks or listening
  const ari = speeches.find(s => s.who === 'ari' && T >= s.a && T <= s.b);
  const stud = speeches.find(s => s.who === 'student' && T >= s.a && T <= s.b + .5);
  setGlow(stations.voice, Math.max(...speeches.filter(s => s.who === 'ari').map(s => pulse(T, s.a - .4, s.b))));
  setGlow(stations.motion, ari ? .8 : stud ? .4 : .1);

  // tower
  const conv = TL.conv.filter(c => T >= c.at).pop()?.tokens || 0;
  const noteOn = noteDock && T >= noteDock - .5 && T < noteGone + 1;
  const noteScale = noteOn ? smooth((T - (noteDock - .5)) / .8) * (T > noteGone ? 1 - smooth((T - noteGone) / 1) : 1) : 0;
  const memOn = rememberAt && T >= rememberAt;
  const rw = readWindows.findIndex(([a, b]) => T >= a && T <= b);
  const lit = rw >= 0 ? TURNS[rw].lights : [];
  const reading = speeches.find(s => s.who === 'reading' && T >= s.a - .1 && T <= s.b + .1);
  let y = 0;
  for (const c of [...CONTEXT].reverse()) {
    const s = slabs[c.id];
    let tokens = c.grows ? Math.max(30, conv) : c.tokens;
    let h = Math.max(.14, tokens * UNIT);
    if (c.id === 'note') h *= noteScale;
    if (c.id === 'memory') h = memOn ? .3 : .14;
    s.g.visible = h > .02;
    s.g.scale.y = Math.max(.001, h); s.g.position.y = y + h / 2;
    y += h + (h > .02 ? .08 : 0);
    let glow = lit.includes(c.id) ? .85 : (reading ? .25 : 0);
    if (c.id === 'note' && noteOn && T < noteDock + .6) glow = 1;
    setGlow(s.g, glow);
    s.lb.element.classList.toggle('dim', !!lit.length && !lit.includes(c.id));
    // wire to LLM
    const ln = wireToLLM[c.id];
    if (ln) {
      const from = tower.position.clone().add(new THREE.Vector3(-1.8, s.g.position.y, 0));
      const to = P.llm.clone().add(new THREE.Vector3(.8, .6, 0));
      ln.geometry.setFromPoints([from, to]); ln.visible = s.g.visible;
      ln.material.opacity = lit.includes(c.id) ? .95 : reading ? .35 : .1;
    }
  }
  slabs.conv.lb.element.querySelector('small').textContent = `kept by the HF server · ${conv} tokens so far · not limited to 24`;
  slabs.memory.lb.element.querySelector('small').textContent = memOn ? '1 fact saved · enters on the next instructions rebuild' : 'from the remember tool · empty';
  towerTitle.position.set(0, y + .9, 0);

  // Mac window + memory file
  let filled = 0;
  TL.slotFill.forEach((f, i) => { const on = T >= f.at; if (on) filled++; const m = slots[i % 24]; m.material.color.setHex(on ? (f.role === 'ari' ? C.authored : C.live) : 0x26313a); m.material.emissive.setHex(on ? 0x111111 : 0); });
  winLabel.element.querySelector('small').textContent = `${Math.min(filled, 24)} / 24 · copy kept on the Mac for the researcher`;
  setGlow(memFile, memOn ? (T < rememberAt + 1 ? 1 : .5) : 0);
  memLabel.element.querySelector('small').textContent = memOn ? '1 fact on disk · survives restart' : '0 facts on disk';

  // OpenAI stack + timer
  const aiVisible = research && T >= research.arrive && T <= research.leave + .6;
  aiStack.visible = !!aiVisible; aiStack.children.forEach((g, i) => { if (g.userData.fill) setGlow(g, aiVisible ? .4 : 0); });
  if (research && T >= research.arrive && T <= research.leave) {
    const el = T - research.arrive;
    aiTimer.visible = true; aiTimer.geometry.dispose();
    aiTimer.geometry = new THREE.RingGeometry(2.4, 2.6, 64, 1, Math.PI / 2, Math.max(.01, el / 45 * Math.PI * 2));
    aiTimer.lookAt(camera.position);
    aiTimerLabel.userData.want = true; aiTimerLabel.element.innerHTML = `<b>${el.toFixed(1)} s</b><small>of a 45 s timeout · illustrative</small>`;
  } else { aiTimer.visible = false; aiTimerLabel.userData.want = false; }

  // packets
  let n = 0;
  for (const s of TL.streams) {
    if (T < s.a || T > s.b + s.T) continue;
    for (let e = s.a; e <= s.b; e += .09) {
      const u = (T - e) / s.T; if (u < 0 || u > 1) continue;
      if (n >= PK_MAX) break;
      s.route.at(u, tmpV); tmpM.makeTranslation(tmpV.x, tmpV.y, tmpV.z);
      pk.setMatrixAt(n, tmpM); pk.setColorAt(n, tmpC.setHex(s.color)); n++;
    }
  }
  pk.count = n; pk.instanceMatrix.needsUpdate = true; if (pk.instanceColor) pk.instanceColor.needsUpdate = true;

  // flyers
  for (const f of TL.flyers) {
    const u = (T - f.a) / f.T, on = u >= 0 && u <= 1.15;
    f.mesh.visible = on; if (f.lbl) f.lbl.userData.want = on && u <= 1.05;
    if (on) { f.route.at(Math.min(1, u), f.mesh.position); if (f.text) f.mesh.lookAt(camera.position.x, f.mesh.position.y, camera.position.z); }
  }

  // embedding points
  embMeshes.forEach((m, i) => { m.visible = T >= TL.embed[i].at; });
  embLine.geometry.setDrawRange(0, embMeshes.filter(m => m.visible).length);
  lens.rotation.y += dt * .05;

  // robot: breathing, antennas freeze while listening, head wobble from loudness while speaking
  if (robot) {
    const breathe = Math.sin(T * 1.3);
    let loud = 0;
    if (ari) { const k = (T - ari.a) * 6.5; loud = Math.max(0, Math.sin(k) * .6 + Math.sin(k * 2.3 + 1) * .4) * (0.6 + .4 * Math.sin(k * .37)); }
    headPivot.rotation.set(loud * .07 + breathe * .01, loud * .03 * Math.sin(T * 3), loud * .05 * Math.sin(T * 4.1));
    const listen = speeches.find(s => s.who === 'student' && T >= s.a && T <= s.b + .5);
    const freezeAt = listen ? listen.a : null;
    const sway = tt => Math.sin(tt * 1.3) * .25;
    let ant = sway(T);
    if (freezeAt !== null) ant = sway(freezeAt);
    else { const prev = speeches.filter(s => s.who === 'student' && T > s.b + .5).pop(); if (prev) { const k = clamp01((T - (prev.b + .5)) / .4); ant = sway(prev.a) * (1 - k) + sway(T) * k; } }
    robot.setJointValue('right_antenna', ant); robot.setJointValue('left_antenna', -ant);
  }
  student.element.style.opacity = stud ? 1 : .35;
  wsLabel.userData.want = TL.streams.some(s => T >= s.a && T <= s.b + s.T);
  ttsWarn.userData.want = !!ari;
  aiNever.userData.want = !!aiVisible;
  syncLabels();

  syncSpeech();
  direct(dt);
  updateUI();
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}
// gentle camera director: no cuts, the orbit just leans toward where the action is
let directing = true;
controls.addEventListener('start', () => { directing = false; controls.autoRotate = false; ui.cam.textContent = 'Auto camera off'; ui.cam.setAttribute('aria-pressed', 'false'); });
ui.cam.onclick = () => { directing = !directing; controls.autoRotate = directing && !matchMedia('(prefers-reduced-motion: reduce)').matches; ui.cam.textContent = directing ? 'Auto camera on' : 'Auto camera off'; ui.cam.setAttribute('aria-pressed', directing); };
const FOCUS = { home: [new THREE.Vector3(10, 3, 2), 36], tower: [new THREE.Vector3(16, 4, 1), 34], ai: [new THREE.Vector3(14, 6, -12), 58], embed: [new THREE.Vector3(2, 3, -2), 38] };
const tmpOff = new THREE.Vector3();
function direct(dt) {
  if (!directing) return;
  let f = FOCUS.home;
  if (research && T > research.send - .5 && T < research.leave + 2.5) f = FOCUS.ai;
  else if (speeches.some(s => s.who === 'reading' && T >= s.a - .3 && T <= s.b + .6)) f = FOCUS.tower;
  const k = 1 - Math.exp(-dt * .9);
  controls.target.lerp(f[0], k);
  tmpOff.subVectors(camera.position, controls.target);
  const d = tmpOff.length(); tmpOff.setLength(d + (f[1] - d) * k);
  camera.position.copy(controls.target).add(tmpOff);
}
updateUI();
requestAnimationFrame(frame);
window.__viz = { seek: x => { T = x; }, END, play: () => ui.play.click() };
