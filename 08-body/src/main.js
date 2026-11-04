import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import GUI from "lil-gui";
import { loadRobot } from "./robot.js";
import { createPose } from "./pose.js";
import { createHud } from "./hud.js";

const BASE_DISTANCE = 0.9; // metres between bases; tuned so blades only meet in the middle

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080c);
scene.fog = new THREE.Fog(0x07080c, 3, 8);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 50);
camera.position.set(0, 0.7, -BASE_DISTANCE / 2 - 0.9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.2, 0);
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

const hud = createHud({ jointNames: me.jointNames, limits: me.limits });
document.getElementById("status").remove();

const pose = createPose({
  video: document.getElementById("video"),
  overlay: document.getElementById("overlay"),
  limits: me.limits,
});
window.duel = { me, sliders, pose };
let cameraError = null;
pose.start().catch((e) => { cameraError = e.message || String(e); control.camera = false; });
addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "c") pose.recalibrate(); });

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

let last = performance.now(), frames = 0, rateT = last, controlHz = 60, clamped = new Set();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (now - rateT >= 1000) { controlHz = (frames * 1000) / (now - rateT); frames = 0; rateT = now; }
  frames++;

  if (control.camera && pose.state === "tracking") {
    for (const [name, target] of Object.entries(pose.targets)) {
      if (!Number.isFinite(target)) continue;
      const step = MAX_VELOCITY * dt;
      current[name] += Math.max(-step, Math.min(step, target - current[name]));
    }
    Object.assign(sliders[0], current);
    me.setJoints(current);
    clamped = pose.clamped;
  } else {
    Object.assign(current, sliders[0]);
    clamped = new Set();
  }

  hud.update({
    angles: current, clamped, perceptionHz: pose.hz, controlHz,
    message: cameraError ? `camera unavailable (${cameraError}) — use the sliders` : pose.status,
  });
  controls.update();
  composer.render();
});
