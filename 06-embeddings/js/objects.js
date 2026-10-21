// objects.js — the hidden objects: seeding them into Firestore with
// embeddings, and placing each one in the room whose meaning fits it best.

import { db } from "./firebase.js";
import {
  collection, getDocs, doc, setDoc, runTransaction,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { embedText, cosine } from "./embed.js";

export const OBJECT_NAMES = [
  "rusty key", "brass compass", "broken watch", "love letter", "seashell",
  "candle stub", "map fragment", "toy boat", "silver spoon", "old lantern",
  "glass marble", "torn photograph", "golden ring", "wooden flute", "ink bottle",
  "feather quill", "music box", "pocket knife", "dried flower", "cracked mirror",
];

// A thought and an object name score 0.27 to 0.71 with CLIP text embeddings
// (median about 0.52), so 0.2 would hand an object to every room. 0.55 keeps
// only the matches that make sense, e.g. "a rusty garage full of tools" with
// "rusty key".
export const PLACEMENT_THRESHOLD = 0.55;

const SEED_PARALLEL = 4;

function slug(name) {
  return name.replace(/\s+/g, "-");
}

export async function loadObjects() {
  const snapshot = await getDocs(collection(db, "objects"));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Embed and save every object that isn't in Firestore yet. Safe to run again.
export async function seedObjects(onProgress) {
  const existing = new Set((await loadObjects()).map((o) => o.id));
  const missing = OBJECT_NAMES.filter((name) => !existing.has(slug(name)));
  let done = 0;
  const queue = [...missing];

  async function worker() {
    while (queue.length) {
      const name = queue.shift();
      const embedding = await embedText(name);
      await setDoc(doc(db, "objects", slug(name)), { name, embedding, placedInRoomId: null });
      onProgress(++done, missing.length);
    }
  }
  await Promise.all(Array.from({ length: SEED_PARALLEL }, worker));
  return missing.length;
}

// Give a new room the unplaced object that fits it best, if any fits well
// enough. A transaction makes sure two rooms can't claim the same object.
// Returns the object placed, or null.
export async function placeObjectInRoom(roomId, roomEmbedding) {
  const candidates = (await loadObjects())
    .filter((object) => !object.placedInRoomId)
    .map((object) => ({ object, score: cosine(roomEmbedding, object.embedding) }))
    .filter(({ score }) => score >= PLACEMENT_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  for (const { object } of candidates) {
    const objectRef = doc(db, "objects", object.id);
    const claimed = await runTransaction(db, async (transaction) => {
      const fresh = await transaction.get(objectRef);
      if (fresh.data().placedInRoomId) return false; // someone got there first
      transaction.update(objectRef, { placedInRoomId: roomId });
      transaction.update(doc(db, "rooms", roomId), { objectId: object.id });
      return true;
    });
    if (claimed) return object;
  }
  return null;
}
