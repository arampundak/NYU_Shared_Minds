// paint.js — thought -> painted room image, as a small base64 JPEG.
//
// Two nano-banana passes, both shown the Monkey Island reference screenshots:
//   1. paint the scene from the thought;
//   2. mark the three door spots on that scene with solid magenta, and ask for
//      each mark to be repainted as a real door built into the scenery.
// That way the doors belong to the painting instead of being pasted on top.

import { runModel } from "./replicate.js";
import { ROOM_WIDTH, ROOM_HEIGHT, DOORS, doorPath } from "./layout.js";

export { ROOM_WIDTH, ROOM_HEIGHT };

// Same trick as week 4: Replicate's image hosts don't send CORS headers, so
// route the image through weserv.nl to be able to read it back off a canvas.
const CORS_FRIENDLY_IMAGE_PROXY = "https://images.weserv.nl/?url=";

const REFERENCE_FILES = [
  "reference/comi_indoor.png",
  "reference/comi_indoors_2.jpg",
  "reference/comi_outdoors.jpg",
  "reference/comi_outdoors_2.png",
];
const REFERENCE_WIDTH = 512;

export const STYLE_PROMPT =
 "painted as a 1997 hand-painted cartoon adventure game background in the style of The Curse of Monkey Island, " +
  "lush gouache and watercolor textures, crisp hand-inked black outlines of varying thickness, " +
  "everything drawn whimsical and wobbly: nothing perfectly straight, shapes lean, curl, taper and swoop, " +
  "exaggerated stretched proportions, " +
  "warm glowing light with deep teal and violet shadows, rich saturated colors, " +
  "storybook 2D Disney-era cel animation quality, playful and slightly spooky, " +
  "wide side view seen straight on, a broad empty open floor across the bottom third, " +
  "uncluttered space at the left and right edges, an empty stage waiting for characters";
  //"hand-painted 1990s cartoon point-and-click pirate adventure game background, " +
  //"bold saturated colors, thick whimsical shapes, exaggerated perspective, open scene seen straight on, " +
  //"wide open flat ground across the bottom third, no ceiling, no walls, " +
  //"no pillars or objects at the left and right edges, " +
  //"no characters, no text, no title, no logo, no signature";


const NO_EXTRAS =
  "Do not include any characters, people, text, subtitles, signs with writing, title, logo or signature.";

const DOOR_MARKER_COLOR = "#ff00ff";

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`couldn't load ${src.slice(0, 60)}`));
    img.src = src;
  });
}

// The reference screenshots, shrunk once and kept as JPEG data URLs.
let referencesPromise = null;
function loadReferences() {
  referencesPromise ??= Promise.all(
    REFERENCE_FILES.map(async (file) => {
      const img = await loadImage(file);
      const canvas = document.createElement("canvas");
      canvas.width = REFERENCE_WIDTH;
      canvas.height = Math.round((img.height / img.width) * REFERENCE_WIDTH);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.85);
    })
  );
  return referencesPromise;
}

// nano-banana returns a 16:9 canvas but often paints into the middle of it,
// leaving black bars above and below. Cut those off, then crop to fill a
// 768x432 canvas.
function fitToRoom(img) {
  const full = document.createElement("canvas");
  full.width = img.width;
  full.height = img.height;
  const fullCtx = full.getContext("2d");
  fullCtx.drawImage(img, 0, 0);

  // Average brightness of each row, measured on a thin copy for speed.
  const thin = fullCtx.getImageData(0, 0, full.width, full.height);
  const rowIsBar = (y) => {
    let sum = 0;
    for (let x = 0; x < full.width; x += 8) {
      const i = (y * full.width + x) * 4;
      sum += thin.data[i] + thin.data[i + 1] + thin.data[i + 2];
    }
    return sum / (full.width / 8) / 3 < 14;
  };
  let top = 0;
  let bottom = full.height - 1;
  while (top < bottom && rowIsBar(top)) top++;
  while (bottom > top && rowIsBar(bottom)) bottom--;
  if (bottom - top < full.height * 0.5) {
    top = 0;
    bottom = full.height - 1; // not bars after all
  }

  // Crop the content area to 16:9 around its center.
  const contentHeight = bottom - top + 1;
  let sourceWidth = full.width;
  let sourceHeight = contentHeight;
  if (sourceWidth / sourceHeight > ROOM_WIDTH / ROOM_HEIGHT) {
    sourceWidth = sourceHeight * (ROOM_WIDTH / ROOM_HEIGHT);
  } else {
    sourceHeight = sourceWidth * (ROOM_HEIGHT / ROOM_WIDTH);
  }
  const sourceX = (full.width - sourceWidth) / 2;
  const sourceY = top + (contentHeight - sourceHeight) / 2;

  const room = document.createElement("canvas");
  room.width = ROOM_WIDTH;
  room.height = ROOM_HEIGHT;
  room.getContext("2d").drawImage(
    full, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, ROOM_WIDTH, ROOM_HEIGHT
  );
  return room;
}

// One nano-banana call; resolves to a 768x432 canvas.
async function askNanoBanana(prompt, images, onRetry) {
  const output = await runModel(
    "google/nano-banana",
    { prompt, image_input: images, aspect_ratio: "16:9", output_format: "jpg" },
    onRetry
  );
  const url = Array.isArray(output) ? output[0] : output;
  const img = await loadImage(CORS_FRIENDLY_IMAGE_PROXY + encodeURIComponent(url));
  return fitToRoom(img);
}

// A copy of the scene with a solid magenta arch where each door goes.
function markDoorSpots(scene) {
  const marked = document.createElement("canvas");
  marked.width = ROOM_WIDTH;
  marked.height = ROOM_HEIGHT;
  const ctx = marked.getContext("2d");
  ctx.drawImage(scene, 0, 0);
  ctx.fillStyle = DOOR_MARKER_COLOR;
  for (const door of DOORS) {
    doorPath(ctx, door);
    ctx.fill();
  }
  return marked.toDataURL("image/jpeg", 0.92);
}

function scenePrompt(thought, referenceCount) {
  return (
    `Paint a new background scene of: ${thought}. ` +
    `The ${referenceCount} attached images show the art style to imitate (brush work, outlines, color, lighting). ` +
    `Copy only their style, never their content. ${STYLE_PROMPT}. ${NO_EXTRAS}`
  );
}

const DOOR_PROMPT =
  "This is a painted adventure game background. Three solid magenta arch-shaped markers show where doors must be. " +
  "Replace each magenta marker with a real painted wooden door or doorway that belongs to the scenery " +
  "(set into a wall, rock, tree, hut or gate, whatever fits), keeping the same position and size as the marker. " +
  `Keep everything else in the image unchanged, in the same art style. No magenta may remain. ${NO_EXTRAS}`;

function toBase64(canvas) {
  return canvas.toDataURL("image/jpeg", 0.8).replace(/^data:image\/jpeg;base64,/, "");
}

// Returns a plain base64 JPEG string (no "data:" prefix), small enough to sit
// in a Firestore document. `onStatus(message)` reports progress and retries.
// `onScene(base64)` is called as soon as the scene (without painted doors) is
// ready, so the caller can show it while the door pass is still running.
export async function paintRoom(thought, onStatus = () => {}, onScene = () => {}) {
  const references = await loadReferences();

  onStatus("Painting the scene... (about 30 seconds)");
  const scene = await askNanoBanana(scenePrompt(thought, references.length), references, (attempt) =>
    onStatus(`Painting failed, trying again (${attempt})...`)
  );

  onScene(toBase64(scene));
  onStatus("Adding the doors...");
  const withDoors = await askNanoBanana(DOOR_PROMPT, [markDoorSpots(scene)], (attempt) =>
    onStatus(`Adding the doors failed, trying again (${attempt})...`)
  );

  return toBase64(withDoors);
}
