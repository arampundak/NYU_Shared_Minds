// webcam + ml5 bodyPose -> SO-100 joint targets (perception loop, ~30 Hz)

export const VIDEO_W = 640;
export const VIDEO_H = 480;
const MIN_CONF = 0.3;
const CAL_SECONDS = 3;

// retargeting constants, mapped from how the SO-100 actually moves:
// shoulder_lift 0 = upper arm straight back, ~1.57 = straight up, ~3 = straight forward.
// elbow_flex -PI = straight arm, 0 = fully folded.
const K = {
  panShift: 1.6,   // rad per shoulder-width of hip shift
  panTilt: 2.0,    // rad per rad of shoulder-line tilt
  liftHang: 3.5,   // arm hanging  -> SO-100 reaches forward-low (it cannot hang)
  liftUp: 1.57,    // arm overhead -> SO-100 points straight up
  wrist: 0.5,
  roll: Math.PI,
};

const REQUIRED = ["left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_elbow", "right_elbow", "left_wrist", "right_wrist"];

export const BONES = [
  ["left_shoulder", "right_shoulder"], ["left_shoulder", "left_hip"], ["right_shoulder", "right_hip"], ["left_hip", "right_hip"],
  ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"], ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
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
  return {
    shoulderWidth: len(sub(kp.right_shoulder, kp.left_shoulder)),
    hipX: mid(kp.left_hip, kp.right_hip).x,
    tilt: Math.atan2(kp.right_shoulder.y - kp.left_shoulder.y, kp.right_shoulder.x - kp.left_shoulder.x),
    wristY: (kp.left_wrist.y + kp.right_wrist.y) / 2,
  };
}

// kp: mirrored keypoints by name; cal: from measure() during calibration
export function retarget(kp, cal, hand = "right") {
  const other = hand === "right" ? "left" : "right";
  const s = kp[`${hand}_shoulder`], e = kp[`${hand}_elbow`], w = kp[`${hand}_wrist`];
  const shoulderC = mid(kp.left_shoulder, kp.right_shoulder);
  const hipC = mid(kp.left_hip, kp.right_hip);
  const torsoDown = unit(sub(hipC, shoulderC));
  const upper = sub(e, s), fore = sub(w, e);
  const sw = cal.shoulderWidth;

  const lift = angleBetween(upper, torsoDown);            // 0 hanging .. PI overhead
  const elbow = angleBetween(sub(s, e), fore);            // PI straight .. 0 folded
  const foreFromDown = angleBetween(fore, torsoDown);     // 0 pointing down .. PI up
  const tilt = measure(kp).tilt - cal.tilt;
  const shift = (hipC.x - cal.hipX) / sw;
  const rollRaw = (cal.wristY - kp[`${other}_wrist`].y) / (2 * sw); // other hand raised above its neutral height

  return {
    shoulder_pan: -(K.panShift * shift + K.panTilt * tilt),   // robot +pan is toward screen-left
    shoulder_lift: K.liftHang - (lift / Math.PI) * (K.liftHang - K.liftUp),
    elbow_flex: -elbow,
    wrist_flex: K.wrist * (Math.PI / 2 - foreFromDown),
    wrist_roll: clamp(rollRaw, -1, 1) * K.roll,
    gripper: 0,
  };
}

// ---- one-euro filter ----
class OneEuro {
  constructor(minCutoff = 1.5, beta = 0.08, dCutoff = 1) {
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
    state: "starting",       // starting | waiting | calibrating | tracking
    calProgress: 0,
    cal: null,
    targets: {},             // filtered + clamped joint targets
    clamped: new Set(),
    hz: 0,
    async start() {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: VIDEO_W, height: VIDEO_H }, audio: false });
      video.srcObject = stream;
      await video.play();
      const net = await ml5.bodyPose("MoveNet", { modelType: "SINGLEPOSE_LIGHTNING" });
      pose.state = "waiting";
      net.detectStart(video, onResults);
    },
    recalibrate() { pose.state = "waiting"; pose.calProgress = 0; samples = []; calStart = null; },
  };

  let samples = [], calStart = null, frames = 0, rateT = performance.now();

  function onResults(results) {
    const now = performance.now();
    frames++;
    if (now - rateT >= 1000) { pose.hz = (frames * 1000) / (now - rateT); frames = 0; rateT = now; }

    // mirror x to match the selfie-view preview; hold last good value under low confidence
    for (const k of results[0]?.keypoints ?? []) {
      if (k.confidence >= MIN_CONF) lastGood[k.name] = { x: VIDEO_W - k.x, y: k.y };
    }
    const ready = REQUIRED.every((n) => lastGood[n]);
    drawOverlay(results[0]?.keypoints);
    if (!ready) return;

    if (pose.state === "waiting" || pose.state === "calibrating") calibrate(now);
    else track(now / 1000);
  }

  function calibrate(now) {
    if (pose.state === "waiting") { pose.state = "calibrating"; calStart = now; samples = []; }
    samples.push(measure(lastGood));
    pose.calProgress = (now - calStart) / (CAL_SECONDS * 1000);
    if (pose.calProgress < 1) return;
    const avg = (key) => samples.reduce((a, s) => a + s[key], 0) / samples.length;
    pose.cal = { shoulderWidth: avg("shoulderWidth"), hipX: avg("hipX"), tilt: avg("tilt"), wristY: avg("wristY") };
    pose.state = "tracking";
  }

  function track(t) {
    const raw = retarget(lastGood, pose.cal, pose.hand);
    pose.clamped.clear();
    for (const [name, v] of Object.entries(raw)) {
      filters[name] ??= new OneEuro();
      const f = filters[name].filter(v, t);
      const { lower, upper } = limits[name];
      if (f < lower || f > upper) pose.clamped.add(name);
      pose.targets[name] = clamp(f, lower, upper);
    }
  }

  function drawOverlay(kps) {
    ctx.clearRect(0, 0, VIDEO_W, VIDEO_H);
    const at = (n) => lastGood[n];
    ctx.lineWidth = 3;
    for (const [a, b] of BONES) {
      if (!at(a) || !at(b)) continue;
      const sword = a.startsWith(pose.hand) && b.startsWith(pose.hand) && (a.includes("elbow") || b.includes("wrist"));
      ctx.strokeStyle = sword ? "#30f0ff" : "#5b6785";
      ctx.beginPath(); ctx.moveTo(at(a).x, at(a).y); ctx.lineTo(at(b).x, at(b).y); ctx.stroke();
    }
    ctx.fillStyle = "#ffb020";
    for (const k of kps ?? []) if (k.confidence >= MIN_CONF) { ctx.beginPath(); ctx.arc(VIDEO_W - k.x, k.y, 4, 0, 7); ctx.fill(); }
  }

  return pose;
}
