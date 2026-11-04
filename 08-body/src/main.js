import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import GUI from "lil-gui";
import { loadRobot } from "./robot.js";
import { createPose, K } from "./pose.js";
import { createHud } from "./hud.js";
import { createFx } from "./fx.js";
import { createGame } from "./game.js";
import { dummyAngles } from "./dummy.js";
import { createNet } from "./net.js";
import { createFrames } from "./frames.js";
import { showMenu, getName } from "./menu.js";

const BASE_DISTANCE = 0.9; // metres between bases; tuned so blades only meet in the middle

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080c);
scene.fog = new THREE.Fog(0x07080c, 3, 8);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 50);
camera.position.set(0, 0.85, -BASE_DISTANCE / 2 - 0.95); // behind and above your own robot
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.22, 0.15);
controls.update();

scene.add(new THREE.HemisphereLight(0xaab4ff, 0x10121a, 1.2));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(1, 2, -1);
scene.add(key);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.9 })
);
scene.add(floor, new THREE.GridHelper(6, 24, 0x2a3350, 0x161b2b));

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.5, 0.85));
composer.addPass(new OutputPass());

const PLAYERS = [
  { name: "you", color: 0xffb020, blade: 0x30f0ff, z: -BASE_DISTANCE / 2, yaw: 0 },
  { name: "opponent", color: 0x4aa8ff, blade: 0xff3070, z: BASE_DISTANCE / 2, yaw: Math.PI },
];

const gui = new GUI({ title: "joints" });
const robots = [];
const sliders = []; // per-robot angle objects the lil-gui sliders write into

for (const p of PLAYERS) {
  const robot = await loadRobot(p);
  robot.root.position.z = p.z;
  robot.root.rotation.y = p.yaw;
  scene.add(robot.root);
  robots.push(robot);

  const angles = {};
  const folder = gui.addFolder(p.name);
  for (const name of robot.jointNames) {
    const { lower, upper } = robot.limits[name];
    angles[name] = 0;
    folder.add(angles, name, lower, upper, 0.01).listen().onChange(() => robot.setJoints(angles));
  }
  robot.setJoints(angles);
  sliders.push(angles);
}

const me = robots[0];
const current = { ...sliders[0] };       // what the control loop has actually reached
const MAX_VELOCITY = 8;                  // rad/s: gives the arm weight
const control = { camera: true };
gui.add(control, "camera").name("camera drives you");
const hand = { hand: "right" };
gui.add(hand, "hand", ["right", "left"]).name("sword arm").onChange((h) => (pose.hand = h));

const feel = gui.addFolder("feel (tune live)");
feel.add(K, "minCutoff", 0.2, 4, 0.05).name("smoothing (low = smooth)");
feel.add(K, "beta", 0, 0.5, 0.005).name("fast-move response");
feel.add(K, "deadzone", 0, 0.15, 0.005).name("jitter dead zone");
feel.add(K, "panArm", 0, 2, 0.05).name("pan: arm side swing");
feel.add(K, "panShift", 0, 2, 0.05).name("pan: body shift");
feel.add(K, "panTilt", 0, 3, 0.05).name("pan: lean");
feel.add(K, "wrist", 0, 1.5, 0.05).name("wrist: hand bend gain");

const hud = createHud({ jointNames: me.jointNames, limits: me.limits });
document.getElementById("status").remove();

const pose = createPose({
  video: document.getElementById("video"),
  overlay: document.getElementById("overlay"),
  limits: me.limits,
});
let cameraError = null;
const params = new URLSearchParams(location.search);
// no ?room= and no ?solo: show the start screen first (it reloads with the chosen mode); camera starts only after that
const menuOpen = !params.has("room") && !params.has("solo");
if (menuOpen) showMenu();
if (menuOpen || params.has("nocam")) { cameraError = menuOpen ? null : "camera off (?nocam)"; control.camera = false; }
else pose.start().catch((e) => { cameraError = e.message || String(e); control.camera = false; });
addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "c") pose.recalibrate(); });

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

const fx = createFx(scene);
// no ?room= -> solo: a scripted dummy plays the opponent and this client judges both robots.
// ?room=xyz -> two players; each client judges hits on its own robot only (the defender's screen is the truth).
const room = params.get("room");
const solo = !room;
const inviteLink = room ? `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}` : "";
const myName = (getName() || "YOU").toUpperCase();
const net = solo ? null : createNet({ room, jointNames: me.jointNames, name: myName, prefer: params.get("net") === "firebase" ? "firebase" : "p5live" });
const game = createGame({ robots, fx, judge: solo ? [0, 1] : [0] });
const opponentName = () => (solo ? "DUMMY" : (net.opponentName || "OPP")).toUpperCase();
const overlays = createFrames(robots, scene);

if (net) {
  game.onHit = (hit) => net.sendEvent({ k: "hit", ...hit });
  net.onEvent((ev) => {
    if (ev.k === "hit") game.remoteHit(ev);
    else if (ev.k === "start" && (game.state === "idle" || game.state === "over")) game.start();
  });
}

addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "l" && net) navigator.clipboard?.writeText(inviteLink).then(() => game.say("invite link copied", 1.5));
  if (e.key === "Enter" && !menuOpen && (game.state === "idle" || game.state === "over")) {
    if (net && !net.connected) return;
    game.start();
    net?.sendEvent({ k: "start" });
  }
});

let last = performance.now(), frames = 0, rateT = last, controlHz = 60, clamped = new Set(), clock = 0, autoStarted = false;

function tick(dt) {
  clock += dt;
  if (control.camera && pose.state === "tracking") {
    if (solo && !autoStarted && game.state === "idle") { autoStarted = true; game.start(); }
    for (const [name, target] of Object.entries(pose.targets)) {
      if (!Number.isFinite(target)) continue;
      const step = MAX_VELOCITY * dt;
      current[name] += Math.max(-step, Math.min(step, target - current[name]));
    }
    Object.assign(sliders[0], current);
    clamped = pose.clamped;
  } else {
    Object.assign(current, sliders[0]);
    clamped = new Set();
  }

  // robots get the commanded pose plus any clash/hit recoil
  const withRecoil = (base, i, side) => {
    const r = game.recoilOffset(i, side);
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v + (r[k] ?? 0)]));
  };
  const shown = withRecoil(current, 0, -1);
  me.setJoints(shown);
  if (solo) {
    const d = dummyAngles(clock);
    Object.assign(sliders[1], d);
    robots[1].setJoints(withRecoil(d, 1, 1));
  } else {
    net.sendJoints(shown);
    const o = net.sample();
    if (o) {
      Object.assign(sliders[1], o);
      robots[1].setJoints(withRecoil(o, 1, 1));
    }
  }

  game.update(dt);
  fx.update(dt);
  overlays.update();
}

window.duel = { me, robots, sliders, pose, game, tick, net };

renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (now - rateT >= 1000) { controlHz = (frames * 1000) / (now - rateT); frames = 0; rateT = now; }
  frames++;

  tick(dt);

  hud.update({
    angles: current, clamped, perceptionHz: pose.hz, handHz: pose.handHz, controlHz, net,
    message: cameraError ? `camera unavailable (${cameraError}) — use the sliders` : pose.status,
  });
  const waiting = net && !net.connected && (game.state === "idle" || game.state === "over");
  hud.setGame({
    scores: game.scores, time: game.time, names: [myName, opponentName()],
    banner: menuOpen ? "" : waiting ? "waiting for opponent…" : game.banner,
    sub: menuOpen ? "" : waiting ? `send them this link:  ${inviteLink}  (L copies it)`
      : game.state === "over" ? "press Enter to play again" : "",
  });
  controls.update();
  composer.render();
});
