// paint.js — thought -> painted room image, as a small base64 JPEG.

import { runModel } from "./replicate.js";

// Same trick as week 4: Replicate's image hosts don't send CORS headers, so
// route the image through weserv.nl to be able to read it back off a canvas.
const CORS_FRIENDLY_IMAGE_PROXY = "https://images.weserv.nl/?url=";

export const ROOM_WIDTH = 768;
export const ROOM_HEIGHT = 432; // 16:9

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

async function generateRoomImageUrl(thought, onRetry) {
  const output = await runModel(
    "black-forest-labs/flux-schnell",
    {
      prompt: `${thought}, ${STYLE_PROMPT}`,
      aspect_ratio: "16:9",
      num_outputs: 1,
      output_format: "jpg",
    },
    onRetry
  );
  return Array.isArray(output) ? output[0] : output;
}

// Draw the image on a 768x432 canvas and return a plain base64 JPEG string
// (no "data:" prefix), small enough to sit in a Firestore document.
function toBase64Jpeg(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = ROOM_WIDTH;
        canvas.height = ROOM_HEIGHT;
        canvas.getContext("2d").drawImage(img, 0, 0, ROOM_WIDTH, ROOM_HEIGHT);
        resolve(canvas.toDataURL("image/jpeg", 0.8).replace(/^data:image\/jpeg;base64,/, ""));
      } catch (error) {
        reject(new Error("the painting was blocked by CORS: " + error.message));
      }
    };
    img.onerror = () => reject(new Error("couldn't load the painting"));
    img.src = imageUrl;
  });
}

export async function paintRoom(thought, onRetry) {
  const url = await generateRoomImageUrl(thought, onRetry);
  return toBase64Jpeg(CORS_FRIENDLY_IMAGE_PROXY + encodeURIComponent(url));
}
