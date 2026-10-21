// layout.js — the size of every room painting, and where the floor and the
// three doors sit in it. Shared by the painter (which marks the door spots),
// and the room view (which makes them clickable).

export const ROOM_WIDTH = 768;
export const ROOM_HEIGHT = 432; // 16:9

// The floor is the bottom 38% of the painting.
export const FLOOR_TOP = ROOM_HEIGHT * 0.62;

// Doors: left edge, right edge, back center. The back door is smaller, as if
// further away.
export const DOORS = [
  { id: "near", label: "Near: a room like this one", x: 62, width: 72, height: 124, baseY: FLOOR_TOP + 22 },
  { id: "bridge", label: "Bridge: somewhere far away", x: ROOM_WIDTH - 62, width: 72, height: 124, baseY: FLOOR_TOP + 22 },
  { id: "compass", label: "Compass: steer with a word", x: ROOM_WIDTH / 2, width: 46, height: 76, baseY: FLOOR_TOP + 2 },
];

// Traces a door's arched outline onto `ctx` as the current path.
export function doorPath(ctx, door) {
  const left = door.x - door.width / 2;
  const top = door.baseY - door.height;
  const archRadius = door.width / 2;
  ctx.beginPath();
  ctx.moveTo(left, door.baseY);
  ctx.lineTo(left, top + archRadius);
  ctx.arc(door.x, top + archRadius, archRadius, Math.PI, 0);
  ctx.lineTo(left + door.width, door.baseY);
  ctx.closePath();
}
