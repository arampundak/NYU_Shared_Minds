// "F": RGB axes on every link plus a trail of each blade tip (robotics overlay)
import * as THREE from "three";

const TRAIL = 90;
const LINKS = ["base", "shoulder", "upper_arm", "lower_arm", "wrist", "gripper", "jaw"];

export function createFrames(robots, scene) {
  const axes = [];
  const trails = robots.map((r) => {
    for (const name of LINKS) {
      const a = new THREE.AxesHelper(0.11);
      a.visible = false;
      r.urdf.links[name].add(a);
      axes.push(a);
    }
    const pos = new Float32Array(TRAIL * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(r.bladeColor).multiplyScalar(2), transparent: true, opacity: 0.8 }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    return { line, pos, geo, robot: r, filled: false };
  });

  let on = false;
  addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "f") return;
    on = !on;
    axes.forEach((a) => (a.visible = on));
    trails.forEach((t) => (t.line.visible = on));
  });

  return {
    update() {
      if (!on) return;
      for (const t of trails) {
        const tip = t.robot.bladeSegment().b;
        if (!t.filled) { for (let i = 0; i < TRAIL; i++) tip.toArray(t.pos, i * 3); t.filled = true; }
        t.pos.copyWithin(0, 3);                  // shift the trail back one point, newest at the end
        tip.toArray(t.pos, (TRAIL - 1) * 3);
        t.geo.attributes.position.needsUpdate = true;
      }
    },
  };
}
