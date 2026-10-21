// roomview.js — draws a room painting on a canvas, with a placeholder
// character that walks along the floor strip when you click. The doors are
// painted into the picture; here they are just clickable zones that glow on
// hover. Clicking one walks the character to it, then calls the door handler.

import { ROOM_WIDTH, ROOM_HEIGHT } from "./paint.js";
import { FLOOR_TOP, DOORS, doorPath } from "./layout.js";

const FLOOR_MIDDLE = (FLOOR_TOP + ROOM_HEIGHT) / 2;
const WALK_SPEED = 180; // pixels per second, in painting coordinates

const canvas = document.getElementById("room-canvas");
const ctx = canvas.getContext("2d");
canvas.width = ROOM_WIDTH;
canvas.height = ROOM_HEIGHT;

let painting = null;
let characterX = ROOM_WIDTH / 2;
let targetX = characterX;
let lastTime = null;

// A stand-in until the selfie avatar exists (stage 7). Cartoon proportions
// like the adventure games: big head, small body, about 28% of the room tall.
const CHARACTER_HEIGHT = ROOM_HEIGHT * 0.28;

function drawCharacter(x) {
  const feetY = FLOOR_MIDDLE;
  const h = CHARACTER_HEIGHT;
  ctx.lineWidth = 3;
  ctx.lineJoin = ctx.lineCap = "round";
  ctx.strokeStyle = "#1a1208";

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, feetY, h * 0.28, h * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  // legs
  ctx.fillStyle = "#2c3e63";
  for (const dx of [-h * 0.1, h * 0.1]) {
    ctx.beginPath();
    ctx.roundRect(x + dx - h * 0.06, feetY - h * 0.32, h * 0.12, h * 0.32, 4);
    ctx.fill();
    ctx.stroke();
  }

  // coat
  ctx.fillStyle = "#9b2d2d";
  ctx.beginPath();
  ctx.roundRect(x - h * 0.2, feetY - h * 0.62, h * 0.4, h * 0.36, 8);
  ctx.fill();
  ctx.stroke();

  // head
  ctx.fillStyle = "#f0c8a0";
  ctx.beginPath();
  ctx.ellipse(x, feetY - h * 0.8, h * 0.19, h * 0.21, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // eyes
  ctx.fillStyle = "#1a1208";
  for (const dx of [-h * 0.07, h * 0.07]) {
    ctx.beginPath();
    ctx.arc(x + dx, feetY - h * 0.82, h * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }

  // hat
  ctx.fillStyle = "#1f1f1f";
  ctx.beginPath();
  ctx.roundRect(x - h * 0.22, feetY - h * 0.96, h * 0.44, h * 0.1, 6);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x - h * 0.13, feetY - h * 1.04, h * 0.26, h * 0.12, 6);
  ctx.fill();
  ctx.stroke();
}

// A plain wooden door, only used on the blank stand-in for rooms whose
// painting never finished. Painted rooms have their doors in the picture.
function drawDoor(ctx, door) {
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1a1208";
  ctx.fillStyle = "#7a4a24";
  doorPath(ctx, door);
  ctx.fill();
  ctx.stroke();

  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(door.x, door.baseY - door.height);
  ctx.lineTo(door.x, door.baseY);
  ctx.stroke();
  ctx.fillStyle = "#f2c94c";
  ctx.beginPath();
  ctx.arc(door.x + door.width * 0.28, door.baseY - door.height * 0.42, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

// A soft glow around the painted door you're pointing at.
function drawGlow(door) {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 236, 140, 0.95)";
  ctx.shadowColor = "#ffe680";
  ctx.shadowBlur = 14;
  doorPath(ctx, door);
  ctx.stroke();
  ctx.restore();
}

function drawLabel(text, centerX, y) {
  ctx.font = "bold 15px system-ui, sans-serif";
  const textWidth = ctx.measureText(text).width;
  const x = Math.max(8, Math.min(ROOM_WIDTH - textWidth - 24, centerX - textWidth / 2 - 8));
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.beginPath();
  ctx.roundRect(x, y, textWidth + 16, 24, 6);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x + 8, y + 17);
}

// Painted doors never land exactly on the marks, so be generous.
const DOOR_CLICK_MARGIN = 12;

function doorAt(px, py) {
  return DOORS.find((door) =>
    Math.abs(px - door.x) <= door.width / 2 + DOOR_CLICK_MARGIN &&
    py <= door.baseY && py >= door.baseY - door.height - door.width / 2
  );
}

// The object hidden in this room, drawn as a twinkling sparkle on the floor.
const SPARKLE_RADIUS = 24;
let roomObject = null; // { name, x, y }

// A small stable hash, so a room's sparkle sits in the same place for everyone.
function hashOf(text, salt) {
  let h = 2166136261 ^ salt;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

// Show (or clear, with null) the hidden object for the room being shown.
export function setRoomObject(roomId, object) {
  if (!object) {
    roomObject = null;
    return;
  }
  const minY = FLOOR_TOP + 50;
  roomObject = {
    name: object.name,
    x: 70 + hashOf(roomId, 1) * (ROOM_WIDTH - 140),
    y: minY + hashOf(roomId, 2) * (ROOM_HEIGHT - 30 - minY),
  };
}

function drawSparkle(time) {
  const pulse = 0.8 + 0.2 * Math.sin(time / 220);
  ctx.save();
  ctx.translate(roomObject.x, roomObject.y);

  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, SPARKLE_RADIUS * pulse);
  glow.addColorStop(0, "rgba(255, 244, 170, 0.9)");
  glow.addColorStop(1, "rgba(255, 244, 170, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, SPARKLE_RADIUS * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(time / 1500);
  ctx.fillStyle = "#fffbe0";
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const radius = (i % 2 === 0 ? 13 : 3.5) * pulse;
    const angle = (i * Math.PI) / 4;
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function overSparkle(px, py) {
  return roomObject && Math.hypot(px - roomObject.x, py - roomObject.y) <= SPARKLE_RADIUS;
}

let hoveredDoor = null;
let hoveredSparkle = false;
let pendingTarget = null; // what we're walking toward: { door } or { sparkle: true }
let locked = false;       // true while a door or object is being handled
let onDoor = async () => {};
let onObject = async () => {};

function draw(time) {
  ctx.drawImage(painting, 0, 0, ROOM_WIDTH, ROOM_HEIGHT);
  if (hoveredDoor) drawGlow(hoveredDoor);
  if (roomObject) drawSparkle(time);
  drawCharacter(characterX);
  if (hoveredDoor) drawLabel(hoveredDoor.label, hoveredDoor.x, hoveredDoor.baseY - hoveredDoor.height - 34);
  if (hoveredSparkle) drawLabel(roomObject.name, roomObject.x, roomObject.y - 46);
}

async function arrive() {
  const target = pendingTarget;
  pendingTarget = null;
  if (!target) return;
  locked = true;
  try {
    if (target.door) await onDoor(target.door.id);
    else await onObject();
  } finally {
    locked = false;
  }
}

// One loop runs for the life of the page: it walks the character, redraws
// (the sparkle twinkles), and notices when we've arrived somewhere.
function frame(time) {
  const dt = lastTime === null ? 0 : Math.min(0.1, (time - lastTime) / 1000);
  lastTime = time;

  if (painting) {
    const distance = targetX - characterX;
    const step = WALK_SPEED * dt;
    characterX = Math.abs(distance) <= step ? targetX : characterX + Math.sign(distance) * step;
    if (characterX === targetX && pendingTarget && !locked) arrive();
    draw(time);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// On-screen pixels -> painting coordinates.
function paintingPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * ROOM_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * ROOM_HEIGHT,
  };
}

canvas.addEventListener("click", (event) => {
  if (!painting || locked) return;
  const point = paintingPoint(event);
  let destination = point.x;
  if (overSparkle(point.x, point.y)) {
    pendingTarget = { sparkle: true };
    destination = roomObject.x;
  } else {
    const door = doorAt(point.x, point.y);
    pendingTarget = door ? { door } : null;
    if (door) destination = door.x;
  }
  targetX = Math.max(40, Math.min(ROOM_WIDTH - 40, destination));
});

canvas.addEventListener("mousemove", (event) => {
  if (!painting) return;
  const point = paintingPoint(event);
  hoveredSparkle = Boolean(overSparkle(point.x, point.y));
  hoveredDoor = hoveredSparkle ? null : doorAt(point.x, point.y) || null;
  canvas.style.cursor = hoveredSparkle || hoveredDoor ? "pointer" : "default";
});

canvas.addEventListener("mouseleave", () => {
  hoveredDoor = null;
  hoveredSparkle = false;
});

// `handler(doorId)` is called when the character reaches a door.
export function setDoorHandler(handler) {
  onDoor = handler;
}

// `handler()` is called when the character reaches the sparkle.
export function setObjectHandler(handler) {
  onObject = handler;
}

// Show a room. `base64` may be null if its painting never finished. With
// `keepPosition`, swap the picture without moving the character (used when
// the version with painted doors replaces the first scene).
export function showRoomImage(base64, { keepPosition = false } = {}) {
  return new Promise((resolve) => {
    const finish = (img) => {
      painting = img;
      if (!keepPosition) {
        characterX = targetX = ROOM_WIDTH / 2;
        pendingTarget = hoveredDoor = null;
        hoveredSparkle = false;
      }
      resolve();
    };
    if (!base64) {
      const blank = document.createElement("canvas");
      blank.width = ROOM_WIDTH;
      blank.height = ROOM_HEIGHT;
      const blankCtx = blank.getContext("2d");
      blankCtx.fillStyle = "#b9a98a";
      blankCtx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
      blankCtx.fillStyle = "#8d7b5a";
      blankCtx.fillRect(0, FLOOR_TOP, ROOM_WIDTH, ROOM_HEIGHT - FLOOR_TOP);
      for (const door of DOORS) drawDoor(blankCtx, door);
      finish(blank);
      return;
    }
    const img = new Image();
    img.onload = () => finish(img);
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}
