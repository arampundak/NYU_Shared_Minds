// replicate.js — the "Remember" button: asks an AI to restore the current
// damaged photo, using Replicate's google/nano-banana model through the
// ITP/IMA class proxy (so we don't need our own Replicate account or API key).

import { restoreMemory } from "./memories.js";

const REPLICATE_PROXY_URL = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";

// Replicate's servers host the restored image at a URL like
// replicate.delivery/... but that server doesn't send the CORS header
// ("Access-Control-Allow-Origin") a browser needs to draw the image onto a
// <canvas> and read its pixels back out. images.weserv.nl is a free public
// image-resizing proxy that re-serves any image URL WITH that CORS header —
// we're only using it to route around the missing header, not for resizing
// (we do our own resize on the canvas below).
const CORS_FRIENDLY_IMAGE_PROXY = "https://images.weserv.nl/?url=";

const RESTORE_PROMPT =
  "Restore this damaged, glitched photograph. Repair the corrupted areas " +
  "so it looks like an intact 1990s photo.";

// The underlying model (Gemini, behind this shared class proxy) fails a
// restoration attempt for no fault of ours surprisingly often — testing
// showed the exact same request succeeding on one try and failing the next
// with "Failed to generate image." Retrying the same image a moment later
// usually works, so we try quite a few times before giving up.
const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 1500;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One attempt at asking nano-banana to restore the damaged photo. Returns
// the URL of the resulting image (hosted on Replicate's servers).
async function askNanoBananaOnce(damagedBase64) {
  const response = await fetch(REPLICATE_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/nano-banana",
      input: {
        prompt: RESTORE_PROMPT,
        image_input: [`data:image/jpeg;base64,${damagedBase64}`],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`the proxy responded with ${response.status}`);
  }

  const prediction = await response.json();
  if (prediction.error) {
    throw new Error(prediction.details || prediction.error);
  }
  if (!prediction.output) {
    throw new Error("Replicate didn't return an image");
  }
  return prediction.output;
}

// Ask nano-banana to restore the damaged photo, retrying a few times if the
// shared proxy has a transient hiccup.
async function askNanoBananaToRestore(damagedBase64, onRetry) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await askNanoBananaOnce(damagedBase64);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        if (onRetry) onRetry(attempt);
        await wait(RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

// Load an image from a URL, draw it onto a canvas at 400px on the long side,
// and return it as a plain base64 JPEG string (no "data:" prefix).
function toBase64Jpeg400(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // required for a CORS-clean, readable canvas
    img.onload = () => {
      try {
        const longSide = Math.max(img.width, img.height);
        const scale = 400 / longSide;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

        // This throws a SecurityError if the canvas got "tainted" by a
        // cross-origin image that wasn't served with a CORS header.
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        resolve(dataUrl.replace(/^data:image\/jpeg;base64,/, ""));
      } catch (error) {
        reject(
          new Error(
            "the restored image was blocked by CORS when drawing it to a canvas: " +
              error.message
          )
        );
      }
    };
    img.onerror = () => reject(new Error("couldn't load the restored image"));
    img.src = imageUrl;
  });
}

// The whole "Remember" flow: ask the AI to restore the photo, shrink the
// result back down to our standard size, and save it as the new version.
// `onStatus` is an optional callback for showing progress in the UI, e.g.
// while a transient proxy failure is being retried.
export async function requestRestoration(id, currentDamagedBase64, onStatus) {
  const restoredImageUrl = await askNanoBananaToRestore(currentDamagedBase64, (attempt) => {
    if (onStatus) onStatus(`that attempt failed, trying again (${attempt}/${MAX_ATTEMPTS})...`);
  });
  const corsFriendlyUrl = CORS_FRIENDLY_IMAGE_PROXY + encodeURIComponent(restoredImageUrl);
  const restoredBase64 = await toBase64Jpeg400(corsFriendlyUrl);
  await restoreMemory(id, restoredBase64);
}
