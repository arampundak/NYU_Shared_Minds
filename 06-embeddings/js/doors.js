// doors.js — which room does each door lead to? Pure logic, no page access.

import { embedText, nearest, steer } from "./embed.js";

const COMPASS_STRENGTH = 0.6;
const BRIDGE_FARTHEST_SHARE = 0.3;

// Near door: the room with the highest cosine similarity.
export function nearDoor(current, rooms) {
  const [best] = nearest(current.embedding, rooms, 1, current.id);
  return best ? best.room : null;
}

// Bridge door: among the 30% of rooms least similar to this one, the one with
// the most visits, i.e. the far-away place the most people have been to.
export function bridgeDoor(current, rooms) {
  const others = nearest(current.embedding, rooms, rooms.length, current.id);
  if (!others.length) return null;
  const count = Math.max(1, Math.ceil(others.length * BRIDGE_FARTHEST_SHARE));
  const farthest = others.slice(-count).map((entry) => entry.room);
  const mostVisits = Math.max(...farthest.map((room) => room.visits || 0));
  const popular = farthest.filter((room) => (room.visits || 0) === mostVisits);
  return popular[Math.floor(Math.random() * popular.length)];
}

// Compass door: the room nearest to (this room + a word you type).
export async function compassDoor(current, words, rooms) {
  const wordVector = await embedText(words);
  const target = steer(current.embedding, wordVector, COMPASS_STRENGTH);
  const [best] = nearest(target, rooms, 1, current.id);
  return best ? best.room : null;
}
