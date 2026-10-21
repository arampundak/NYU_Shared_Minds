// modelcheck.js — one test call to each model the project needs, logged to
// the console, so we know up front which ones the class proxy really allows.

import { runModel } from "./replicate.js";
import { embedText, EMBEDDING_MODEL, EMBEDDING_FALLBACK_MODEL } from "./embed.js";

// A tiny drawn image so nano-banana has something to work on.
function testImageDataUrl() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e8c9a0";
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.arc(64, 64, 30, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL("image/jpeg", 0.8);
}

const CHECKS = [
  {
    name: `embedding: ${EMBEDDING_MODEL}`,
    run: async () => `vector of ${(await embedText("a flooded library", EMBEDDING_MODEL)).length} numbers`,
  },
  {
    name: `embedding fallback: ${EMBEDDING_FALLBACK_MODEL}`,
    run: async () => `vector of ${(await embedText("a flooded library", EMBEDDING_FALLBACK_MODEL)).length} numbers`,
  },
  {
    name: "painting: black-forest-labs/flux-schnell",
    run: async () => {
      const out = await runModel("black-forest-labs/flux-schnell", {
        prompt: "a small wooden door", aspect_ratio: "16:9", num_outputs: 1,
      });
      return String(Array.isArray(out) ? out[0] : out);
    },
  },
  {
    name: "avatar: google/nano-banana",
    run: async () => {
      const out = await runModel("google/nano-banana", {
        prompt: "Turn this into a cartoon", image_input: [testImageDataUrl()],
      });
      return String(Array.isArray(out) ? out[0] : out);
    },
  },
  {
    name: "bot thoughts: meta/meta-llama-3-8b-instruct",
    run: async () => {
      const out = await runModel("meta/meta-llama-3-8b-instruct", {
        prompt: "Write one short sentence describing a strange room.", max_tokens: 60,
      });
      return (Array.isArray(out) ? out.join("") : String(out)).trim();
    },
  },
];

// Runs every check one after another; `onResult` is called after each.
export async function verifyModels(onResult) {
  for (const check of CHECKS) {
    let result;
    try {
      const detail = await check.run();
      console.log(`[model check] OK   ${check.name} ->`, detail);
      result = { name: check.name, ok: true, detail };
    } catch (error) {
      console.warn(`[model check] FAIL ${check.name} ->`, error.message);
      result = { name: check.name, ok: false, detail: error.message };
    }
    onResult(result);
  }
}
