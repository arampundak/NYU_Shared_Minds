// roomview.js — draws a room painting on a canvas, with three code-drawn doors
// and a placeholder character that walks along the floor strip when you click.
// Clicking a door walks the character to it, then calls the door handler.

import { ROOM_WIDTH, ROOM_HEIGHT } from "./paint.js";

// The floor is the bottom 38% of the painting.
const FLOOR_TOP = ROOM_HEIGHT * 0.62;
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
let running = false;

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

// Doors are drawn on top of the painting: left edge, right edge, back center.
// The back door is smaller, as if further away.
const DOORS = [
  { id: "near", label: "Near: a room like this one", x: 62, width: 72, height: 124, baseY: FLOOR_TOP + 22 },
  { id: "bridge", label: "Bridge: somewhere far away", x: ROOM_WIDTH - 62, width: 72, height: 124, baseY: FLOOR_TOP + 22 },
  { id: "compass", label: "Compass: steer with a word", x: ROOM_WIDTH / 2, width: 46, height: 76, baseY: FLOOR_TOP + 2 },
];

function drawDoor(door, hovered) {
  const left = door.x - door.width / 2;
  const top = door.baseY - door.height;
  const archRadius = door.width / 2;

  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1a1208";

  ctx.fillStyle = hovered ? "#c98a4b" : "#7a4a24";
  ctx.beginPath();
  ctx.moveTo(left, door.baseY);
  ctx.lineTo(left, top + archRadius);
  ctx.arc(door.x, top + archRadius, archRadius, Math.PI, 0);
  ctx.lineTo(left + door.width, door.baseY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // planks and a knob
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(door.x, top);
  ctx.lineTo(door.x, door.baseY);
  ctx.stroke();
  ctx.fillStyle = "#f2c94c";
  ctx.beginPath();
  ctx.arc(door.x + door.width * 0.28, door.baseY - door.height * 0.42, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawLabel(door) {
  ctx.font = "bold 15px system-ui, sans-serif";
  const textWidth = ctx.measureText(door.label).width;
  const x = Math.max(8, Math.min(ROOM_WIDTH - textWidth - 24, door.x - textWidth / 2 - 8));
  const y = door.baseY - door.height - 34;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.beginPath();
  ctx.roundRect(x, y, textWidth + 16, 24, 6);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(door.label, x + 8, y + 17);
}

function doorAt(px, py) {
  return DOORS.find((door) =>
    Math.abs(px - door.x) <= door.width / 2 &&
    py <= door.baseY && py >= door.baseY - door.height - door.width / 2
  );
}

let hoveredDoor = null;
let pendingDoor = null;   // the door we're walking toward, if any
let locked = false;       // true while a door is being walked through
let onDoor = async () => {};

function draw() {
  ctx.drawImage(painting, 0, 0, ROOM_WIDTH, ROOM_HEIGHT);
  for (const door of DOORS) drawDoor(door, door === hoveredDoor);
  drawCharacter(characterX);
  if (hoveredDoor) drawLabel(hoveredDoor);
}

async function arrive() {
  const door = pendingDoor;
  pendingDoor = null;
  if (!door) return;
  locked = true;
  try {
    await onDoor(door.id);
  } finally {
    locked = false;
  }
}

function frame(time) {
  const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
  lastTime = time;

  const distance = targetX - characterX;
  const step = WALK_SPEED * dt;
  characterX = Math.abs(distance) <= step ? targetX : characterX + Math.sign(distance) * step;
  draw();

  if (characterX !== targetX) {
    requestAnimationFrame(frame);
  } else {
    running = false;
    lastTime = null;
    arrive();
  }
}

function startWalking() {
  if (running) return;
  running = true;
  requestAnimationFrame(frame);
}

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
  pendingDoor = doorAt(point.x, point.y) || null;
  const destination = pendingDoor ? pendingDoor.x : point.x;
  targetX = Math.max(40, Math.min(ROOM_WIDTH - 40, destination));
  if (characterX === targetX) arrive();
  else startWalking();
});

canvas.addEventListener("mousemove", (event) => {
  if (!painting) return;
  const point = paintingPoint(event);
  const door = doorAt(point.x, point.y) || null;
  canvas.style.cursor = door ? "pointer" : "default";
  if (door !== hoveredDoor) {
    hoveredDoor = door;
    if (!running) draw();
  }
});

canvas.addEventListener("mouseleave", () => {
  hoveredDoor = null;
  if (painting && !running) draw();
});

// `handler(doorId)` is called when the character reaches a door.
export function setDoorHandler(handler) {
  onDoor = handler;
}

// Show a room. `base64` may be null if its painting never finished.
export function showRoomImage(base64) {
  return new Promise((resolve) => {
    const finish = (img) => {
      painting = img;
      characterX = targetX = ROOM_WIDTH / 2;
      pendingDoor = hoveredDoor = null;
      draw();
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
      finish(blank);
      return;
    }
    const img = new Image();
    img.onload = () => finish(img);
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}
