// blade and link segments: closest-point distance, clashes, hits
import * as THREE from "three";

const EPS = 1e-8;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection)
export function closestPoints(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= EPS && e <= EPS) { s = t = 0; }
  else if (a <= EPS) { t = clamp01(f / e); }
  else {
    const c = d1.dot(r);
    if (e <= EPS) { s = clamp01(-c / a); }
    else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s), c2 = p2.clone().addScaledVector(d2, t);
  return { dist: c1.distanceTo(c2), a: c1, b: c2 };
}

// blade-blade: returns the contact point, or null
export function findClash(bladeA, bladeB, threshold) {
  const c = closestPoints(bladeA.a, bladeA.b, bladeB.a, bladeB.b);
  return c.dist < threshold ? new THREE.Vector3().lerpVectors(c.a, c.b, 0.5) : null;
}

// attacker blade vs defender links: returns the highest-value link touched, or null
export function findHit(blade, links) {
  let best = null;
  for (const link of links) {
    const c = closestPoints(blade.a, blade.b, link.a, link.b);
    if (c.dist >= blade.radius + link.radius) continue;
    if (!best || link.weight > best.link.weight) best = { link, point: c.a };
  }
  return best;
}
