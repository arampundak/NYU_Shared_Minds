// sparks and sound
import * as THREE from "three";

const MAX = 600;
const GRAVITY = 2.5;

export function createFx(scene) {
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3);
  const vel = new Float32Array(MAX * 3), life = new Float32Array(MAX);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  // soft round sprite so sparks are dots, not squares
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 32;
  const sctx = sprite.getContext("2d");
  const grad = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "#fff"); grad.addColorStop(1, "#0000");
  sctx.fillStyle = grad; sctx.fillRect(0, 0, 32, 32);
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.012, map: new THREE.CanvasTexture(sprite), vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  points.frustumCulled = false;
  scene.add(points);
  let next = 0;

  let audio = null;
  const unlock = () => { audio ??= new AudioContext(); if (audio.state === "suspended") audio.resume(); };
  addEventListener("keydown", unlock);
  addEventListener("pointerdown", unlock);

  function burst(point, color, count, speed) {
    const c = new THREE.Color(color).multiplyScalar(1.6);
    for (let n = 0; n < count; n++) {
      const i = next; next = (next + 1) % MAX;
      pos.set([point.x, point.y, point.z], i * 3);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      vel.set([v.x, v.y, v.z], i * 3);
      col.set([c.r, c.g, c.b], i * 3);
      life[i] = 0.3 + Math.random() * 0.4;
    }
  }

  function tone(freq, endFreq, dur, type, gain) {
    if (!audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(endFreq, audio.currentTime + dur);
    g.gain.setValueAtTime(gain, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + dur);
  }

  function noise(dur, gain) {
    if (!audio) return;
    const buf = audio.createBuffer(1, audio.sampleRate * dur, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = audio.createBufferSource(), g = audio.createGain(), hp = audio.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 2000;
    g.gain.value = gain;
    src.buffer = buf;
    src.connect(hp).connect(g).connect(audio.destination);
    src.start();
  }

  return {
    clash(point) {
      burst(point, 0xfff0c0, 50, 1.8);
      noise(0.08, 0.5); tone(2400, 1800, 0.25, "square", 0.08); tone(3600, 2700, 0.2, "triangle", 0.06);
    },
    hit(point, color) {
      burst(point, color, 40, 1.4);
      tone(180, 50, 0.3, "sine", 0.5); noise(0.12, 0.25);
    },
    beep(high = false) { tone(high ? 880 : 440, high ? 880 : 440, 0.15, "sine", 0.2); },
    update(dt) {
      for (let i = 0; i < MAX; i++) {
        if (life[i] <= 0) { col.fill(0, i * 3, i * 3 + 3); continue; }
        life[i] -= dt;
        vel[i * 3 + 1] -= GRAVITY * dt;
        for (let k = 0; k < 3; k++) pos[i * 3 + k] += vel[i * 3 + k] * dt;
        if (pos[i * 3 + 1] < 0) { pos[i * 3 + 1] = 0; vel[i * 3 + 1] *= -0.3; }
        const fade = Math.min(1, life[i] * 3);
        for (let k = 0; k < 3; k++) col[i * 3 + k] *= fade > 0.98 ? 1 : 0.92;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
    unlock,
  };
}
