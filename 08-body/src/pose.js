// webcam + ml5 bodyPose -> SO-100 joint targets (perception loop, ~30 Hz)

export const VIDEO_W = 640;
export const VIDEO_H = 480;
const MIN_CONF = 0.3;
const HAND_INTERVAL_MS = 70;   // the hand model runs slower than the body model to save GPU
const HAND_MATCH_PX = 110;     // a detected hand counts as the sword hand if its wrist is this close to the body wrist
const HANDS_UP_SECONDS = 1.5; // hold both hands up to start; that pose also calibrates

// retargeting constants, mapped from how the SO-100 actually moves:
// shoulder_lift 0 = upper arm straight back, ~1.57 = straight up, ~3 = straight forward.
// elbow_flex -PI = straight arm, 0 = fully folded.
// exported so the lil-gui "feel" folder can tune them live
export const K = {
  panArm: 0.8,     // rad per shoulder-width of hand sideways swing (the main pan control)
  panShift: 0.8,   // rad per shoulder-width of shoulder-center shift (body shift)
  panTilt: 1.0,    // rad per rad of shoulder-line tilt (lean)
  liftHang: 3.5,   // arm hanging  -> SO-100 reaches forward-low (it cannot hang)
  liftUp: 1.57,    // arm overhead -> SO-100 points straight up
  wrist: 1.0,      // blade tilt per radian of hand bend relative to the forearm
  minCutoff: 0.8,  // filter: lower = smoother but laggier
  beta: 0.05,      // filter: higher = less lag on fast moves
  deadzone: 0.03,  // rad: ignore changes smaller than this (kills jitter)
};

const REQUIRED = ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist"];

// MoveNet's standard skeleton, drawn in full on the preview so you can see the model working
const SKELETON = [
  ["nose", "left_eye"], ["nose", "right_eye"], ["left_eye", "left_ear"], ["right_eye", "right_ear"],
  ["left_shoulder", "right_shoulder"], ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"], ["right_shoulder", "right_hip"], ["left_hip", "right_hip"],
  ["left_hip", "left_knee"], ["left_knee", "left_ankle"], ["right_hip", "right_knee"], ["right_knee", "right_ankle"],
];

// ---- math (pure, so it can be tested without a browser) ----
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const len = (a) => Math.hypot(a.x, a.y);
const unit = (a) => ({ x: a.x / len(a), y: a.y / len(a) });
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (len(a) * len(b)))));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function measure(kp) {
  const shoulderC = mid(kp.left_shoulder, kp.right_shoulder);
  const width = len(sub(kp.right_shoulder, kp.left_shoulder));
  return {
    shoulderWidth: width,
    // sideways hand offset from its shoulder, in shoulder widths (the neutral for pan)
    armDx: {
      left: (kp.left_wrist.x - kp.left_shoulder.x) / width,
      right: (kp.right_wrist.x - kp.right_shoulder.x) / width,
    },
    centerX: shoulderC.x,
    tilt: Math.atan2(kp.right_shoulder.y - kp.left_shoulder.y, kp.right_shoulder.x - kp.left_shoulder.x),
  };
}

// kp: mirrored keypoints by name; cal: from measure() during calibration
export function retarget(kp, cal, hand = "right") {
  const s = kp[`${hand}_shoulder`], e = kp[`${hand}_elbow`], w = kp[`${hand}_wrist`];
  const shoulderC = mid(kp.left_shoulder, kp.right_shoulder);
  const tilt = measure(kp).tilt - cal.tilt;
  // "down the torso" is perpendicular to the shoulder line, so leaning does not change arm angles
  const lineTilt = Math.atan2(kp.right_shoulder.y - kp.left_shoulder.y, kp.right_shoulder.x - kp.left_shoulder.x);
  const torsoDown = { x: -Math.sin(lineTilt), y: Math.cos(lineTilt) };
  const upper = sub(e, s), fore = sub(w, e);
  const sw = cal.shoulderWidth;

  const lift = angleBetween(upper, torsoDown);            // 0 hanging .. PI overhead
  const elbow = angleBetween(sub(s, e), fore);            // PI straight .. 0 folded
  const shift = (shoulderC.x - cal.centerX) / sw;
  const armDx = (w.x - s.x) / sw - cal.armDx[hand];

  const shoulder_lift = K.liftHang - (lift / Math.PI) * (K.liftHang - K.liftUp);
  const elbow_flex = -elbow;
  // wrist: angle between the forearm line (elbow -> wrist) and the hand line (wrist -> middle knuckle),
  // positive when the hand bends outward (away from the body), which tips the blade forward
  const outward = hand === "right" ? 1 : -1;
  const dir = (v) => Math.atan2(outward * v.x, -v.y);      // 0 = up, PI/2 = outward, PI = down (image y points down)
  let bend = kp.hand_vec ? dir(kp.hand_vec) - dir(fore) : 0;
  bend = Math.atan2(Math.sin(bend), Math.cos(bend));        // wrap to (-PI, PI]

  return {
    shoulder_pan: -(K.panArm * armDx + K.panShift * shift + K.panTilt * tilt), // robot +pan is toward screen-left
    shoulder_lift,
    elbow_flex,
    wrist_flex: K.wrist * bend,
    wrist_roll: 0,                                            // optional per spec; off until the basics feel right
    gripper: 0,
  };
}

// ---- one-euro filter ----
class OneEuro {
  constructor(minCutoff = 1, beta = 0.05, dCutoff = 1) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 });
  }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(t - this.t, 1e-3);
    this.dx += OneEuro.alpha(this.dCutoff, dt) * ((v - this.x) / dt - this.dx);
    this.x += OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (v - this.x);
    this.t = t;
    return this.x;
  }
}

// ---- tracker ----
export function createPose({ video, overlay, limits }) {
  const ctx = overlay.getContext("2d");
  const filters = {};
  const lastGood = {};
  const pose = {
    hand: "right",
    state: "starting",       // starting | waiting | calibrating (hands up, held) | tracking
    calProgress: 0,
    cal: null,
    targets: {},             // filtered + clamped joint targets
    clamped: new Set(),
    hz: 0,
    detected: 0,             // people the model sees right now
    missing: [],             // required keypoints not yet seen
    handHz: 0,
    handSeen: false,
    handVec: null,
    get status() {
      if (pose.state === "starting") return "starting camera and model…";
      if (pose.state === "tracking") return "";
      if (pose.detected === 0) return "no person detected: face the camera, check the light";
      if (pose.missing.length) return `can't see: ${pose.missing.join(", ")}`;
      if (pose.state === "calibrating") return "keep both hands up…";
      return "raise BOTH hands above your shoulders to start";
    },
    async start() {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: VIDEO_W, height: VIDEO_H }, audio: false });
      video.srcObject = stream;
      await video.play();
      // ml5.bodyPose returns immediately; the model is only usable once its callback fires
      const net = await new Promise((resolve) => {
        const n = ml5.bodyPose("MoveNet", { modelType: "SINGLEPOSE_LIGHTNING" }, () => resolve(n));
      });
      pose.state = "waiting";
      net.detectStart(video, onResults);
      startHands();
    },
    recalibrate() { pose.state = "waiting"; pose.calProgress = 0; samples = []; calStart = null; for (const f of Object.values(filters)) f.x = null; },
  };

  // hand model: finds the wrist and knuckles so we can draw a hand line and measure its angle to the forearm
  let handLine = null, handSeenAt = 0, handFrames = 0, handRateT = performance.now();
  async function startHands() {
    const hands = await new Promise((resolve) => {
      const n = ml5.handPose({ maxHands: 2, modelType: "lite", flipped: false }, () => resolve(n));
    });
    const loop = async () => {
      const t0 = performance.now();
      await new Promise((resolve) => hands.detect(video, (r) => { onHands(r ?? []); resolve(); }));
      setTimeout(loop, Math.max(0, HAND_INTERVAL_MS - (performance.now() - t0)));
    };
    loop();
  }

  function onHands(results) {
    const now = performance.now();
    handFrames++;
    if (now - handRateT >= 1000) { pose.handHz = (handFrames * 1000) / (now - handRateT); handFrames = 0; handRateT = now; }
    const bodyWrist = lastGood[`${pose.hand}_wrist`];
    let best = null, bestDist = HAND_MATCH_PX;
    for (const h of results) {
      const w = h.wrist, m = h.middle_finger_mcp;
      if (!w || !m || !bodyWrist) continue;
      const d = Math.hypot(VIDEO_W - w.x - bodyWrist.x, w.y - bodyWrist.y); // pick the hand nearest the body-pose wrist
      if (d < bestDist) { bestDist = d; best = { wrist: { x: VIDEO_W - w.x, y: w.y }, mcp: { x: VIDEO_W - m.x, y: m.y } }; }
    }
    handLine = best;
    pose.handSeen = !!best;
    if (best) { handSeenAt = now; pose.handVec = sub(best.mcp, best.wrist); }
    else if (now - handSeenAt > 400) pose.handVec = null; // stale: stop trusting it
  }

  let samples = [], calStart = null, frames = 0, rateT = performance.now();

  function onResults(results) {
    const now = performance.now();
    frames++;
    if (now - rateT >= 1000) { pose.hz = (frames * 1000) / (now - rateT); frames = 0; rateT = now; }

    // mirror x to match the selfie-view preview; hold last good value under low confidence
    for (const k of results[0]?.keypoints ?? []) {
      if (k.confidence >= MIN_CONF) lastGood[k.name] = { x: VIDEO_W - k.x, y: k.y };
    }
    pose.detected = results.length;
    pose.last = results[0];
    pose.missing = REQUIRED.filter((n) => !lastGood[n]);
    drawOverlay(results[0]?.keypoints);
    if (pose.missing.length) { if (pose.state === "calibrating") pose.recalibrate(); return; }

    if (pose.state === "waiting" || pose.state === "calibrating") calibrate(now, lastGood);
    else track(now / 1000, lastGood);
  }

  const handsUp = (kp) => kp.left_wrist.y < kp.left_shoulder.y && kp.right_wrist.y < kp.right_shoulder.y;

  // hold both hands up for a moment: that records shoulder width, center and tilt, then tracking starts
  function calibrate(now, kp) {
    if (!handsUp(kp)) { pose.recalibrate(); return; }
    if (pose.state === "waiting") { pose.state = "calibrating"; calStart = now; samples = []; }
    samples.push(measure(kp));
    pose.calProgress = (now - calStart) / (HANDS_UP_SECONDS * 1000);
    if (pose.calProgress < 1) return;
    const avg = (key) => samples.reduce((a, s) => a + s[key], 0) / samples.length;
    const avgDx = (h) => samples.reduce((a, s) => a + s.armDx[h], 0) / samples.length;
    pose.cal = {
      shoulderWidth: avg("shoulderWidth"), centerX: avg("centerX"), tilt: avg("tilt"),
      armDx: { left: avgDx("left"), right: avgDx("right") },
    };
    pose.state = "tracking";
  }

  function track(t, kp) {
    const raw = retarget({ ...kp, hand_vec: pose.handVec }, pose.cal, pose.hand);
    pose.clamped.clear();
    for (const [name, v] of Object.entries(raw)) {
      if (!Number.isFinite(v)) continue; // degenerate frame (e.g. overlapping keypoints): keep the last target
      filters[name] ??= new OneEuro();
      Object.assign(filters[name], { minCutoff: K.minCutoff, beta: K.beta });
      let f = filters[name].filter(v, t);
      if (name in pose.targets && Math.abs(f - pose.targets[name]) < K.deadzone) f = pose.targets[name]; // dead zone against jitter
      const { lower, upper } = limits[name];
      if (f < lower || f > upper) pose.clamped.add(name);
      pose.targets[name] = clamp(f, lower, upper);
    }
  }

  // draws everything the model returns: confident points bright, doubtful ones dim red
  function drawOverlay(kps = []) {
    ctx.clearRect(0, 0, VIDEO_W, VIDEO_H);
    const byName = Object.fromEntries(kps.map((k) => [k.name, { x: VIDEO_W - k.x, y: k.y, c: k.confidence }]));
    ctx.lineWidth = 3;
    for (const [a, b] of SKELETON) {
      if (!byName[a] || !byName[b]) continue;
      const sword = a.startsWith(pose.hand) && b.startsWith(pose.hand) && (a.includes("elbow") || b.includes("wrist"));
      ctx.globalAlpha = Math.min(byName[a].c, byName[b].c) >= MIN_CONF ? 1 : 0.2;
      ctx.strokeStyle = sword ? "#30f0ff" : "#8a93a6";
      ctx.beginPath(); ctx.moveTo(byName[a].x, byName[a].y); ctx.lineTo(byName[b].x, byName[b].y); ctx.stroke();
    }
    for (const k of Object.values(byName)) {
      ctx.globalAlpha = k.c >= MIN_CONF ? 1 : 0.35;
      ctx.fillStyle = k.c >= MIN_CONF ? "#ffb020" : "#ff3050";
      ctx.beginPath(); ctx.arc(k.x, k.y, 6, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (handLine) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#ff3070";
      ctx.beginPath(); ctx.moveTo(handLine.wrist.x, handLine.wrist.y); ctx.lineTo(handLine.mcp.x, handLine.mcp.y); ctx.stroke();
    }
    drawStatus();
  }

  function drawStatus() {
    const text = pose.status;
    if (pose.state === "calibrating") {
      ctx.fillStyle = "#30f0ff";
      ctx.fillRect(0, VIDEO_H - 14, VIDEO_W * Math.min(1, pose.calProgress), 14);
    }
    if (!text) return;
    ctx.font = "bold 30px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#ffb020";
    ctx.strokeText(text, VIDEO_W / 2, 50, VIDEO_W - 20);
    ctx.fillText(text, VIDEO_W / 2, 50, VIDEO_W - 20);
  }

  return pose;
}
