// embed.js — text -> embedding vector, plus cosine similarity.

import { runModel } from "./replicate.js";

// Community models (not "official" ones) must be pinned to a version hash
// for the class proxy to find them; without it Replicate answers 404.
export const EMBEDDING_MODEL =
  "krthr/clip-embeddings:1c0371070cb827ec3c7f2f28adcdde54b50dcd239aa6faea0bc98b174ef03fb4";
export const EMBEDDING_FALLBACK_MODEL =
  "replicate/all-mpnet-base-v2:b6b7585c9640cd7a9572c6e129c9549d79c9c31f0d3fdce7baac7c67ca38f305";

// Models wrap the vector differently ({embedding: [...]}, [[...]], [{embedding}]),
// so dig out the first flat array of numbers.
function findVector(output) {
  if (Array.isArray(output) && output.length && typeof output[0] === "number") return output;
  if (Array.isArray(output)) return findVector(output[0]);
  if (output && typeof output === "object") return findVector(output.embedding ?? output.embeddings);
  throw new Error("couldn't find a vector in the model output");
}

export async function embedText(text, model = EMBEDDING_MODEL) {
  const output = await runModel(model, { text });
  const vector = findVector(output);
  // Normalise so cosine similarity is just a dot product later.
  const length = Math.hypot(...vector);
  return vector.map((v) => v / length);
}

export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both vectors are unit length
}

// Rooms sorted by cosine similarity to `vector`, best first.
export function nearest(vector, rooms, count, excludeId = null) {
  return rooms
    .filter((room) => room.id !== excludeId)
    .map((room) => ({ room, score: cosine(vector, room.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

// Steering: the point `amount` of the way from `vector` toward `direction`,
// pushed back onto the unit sphere. This is the "compass" arithmetic.
export function steer(vector, direction, amount) {
  const blended = vector.map((v, i) => v + amount * direction[i]);
  const length = Math.hypot(...blended);
  return blended.map((v) => v / length);
}

// Every embedding shares a big common component (any two rooms already score
// about 0.44), which drowns out small steering and makes a few "hub" rooms win
// for every word. Subtracting the average of all rooms removes it.
export function meanVector(vectors) {
  const mean = new Array(vectors[0].length).fill(0);
  for (const vector of vectors) vector.forEach((v, i) => { mean[i] += v / vectors.length; });
  return mean;
}

export function centered(vector, mean) {
  const shifted = vector.map((v, i) => v - mean[i]);
  const length = Math.hypot(...shifted);
  return shifted.map((v) => v / length);
}
