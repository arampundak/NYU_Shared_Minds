// scripted opponent for solo testing: wanders, then lunges straight at you

export function dummyAngles(t) {
  const lunge = Math.pow(Math.max(0, Math.sin(t * 0.7)), 6); // 0 .. 1, a short stab every ~4.5 s
  return {
    shoulder_pan: 0.7 * Math.sin(t * 0.9) + 0.25 * Math.sin(t * 2.3),
    shoulder_lift: 2.3 + 0.35 * Math.sin(t * 1.4 + 1) + 0.5 * lunge,
    elbow_flex: -2.2 + 0.6 * Math.sin(t * 1.1) - 0.9 * lunge,
    wrist_flex: 0.3 * Math.sin(t * 2.1),
    wrist_roll: 0,
    gripper: 0,
  };
}
