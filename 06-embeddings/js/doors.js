// doors.js — which room does each door lead to? Pure logic, no page access.

import { embedText, nearest, steer, meanVector, centered } from "./embed.js";

// The spec started at 0.6, but on these embeddings that never leaves the near
// door's neighbour. Measured on real rooms, 1.5 on centered vectors lands on
// the room a phrase describes while single words still go to varied places.
const COMPASS_STRENGTH = 1.5;
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

// Compass door: the room nearest to (this room + a word you typed), measured
// on centered vectors (see meanVector).
export async function compassDoor(current, words, rooms) {
  const mean = meanVector(rooms.map((room) => room.embedding));
  const wordVector = centered(await embedText(words), mean);
  const target = steer(centered(current.embedding, mean), wordVector, COMPASS_STRENGTH);
  const centeredRooms = rooms.map((room) => ({ ...room, embedding: centered(room.embedding, mean) }));
  const [best] = nearest(target, centeredRooms, 1, current.id);
  if (!best) return null;
  return rooms.find((room) => room.id === best.room.id);
}
