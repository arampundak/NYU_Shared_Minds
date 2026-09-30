// memories.js — all the reads and writes to the "memories" collection.
// This is the only file that knows about Firestore transactions; main.js
// just calls these functions and gets plain data back.

import { db } from "./firebase.js";
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { damageImage, DAMAGE_PER_VIEW, FRAGILE_DAMAGE_PER_VIEW } from "./corruption.js";

const COLLECTION_NAME = "memories";

// Listen to every document in the collection. Calls onChange(memoriesById)
// once immediately and again every time anything changes, anywhere, for
// anyone — this is what makes the grid update live across browser windows.
export function subscribeToAllMemories(onChange) {
  const memoriesRef = collection(db, COLLECTION_NAME);
  return onSnapshot(memoriesRef, (snapshot) => {
    const memoriesById = {};
    snapshot.forEach((docSnapshot) => {
      memoriesById[docSnapshot.id] = docSnapshot.data();
    });
    onChange(memoriesById);
  });
}

// Listen to just one document (used while its overlay is open, so it stays
// live-updated even if someone else looks at or restores the same memory).
export function subscribeToOneMemory(id, onChange) {
  const memoryRef = doc(db, COLLECTION_NAME, id);
  return onSnapshot(memoryRef, (docSnapshot) => {
    if (docSnapshot.exists()) onChange(docSnapshot.data());
  });
}

// Damage one memory by a few random base64 characters and save it back.
// Wrapped in a Firestore transaction: it re-reads the document right before
// writing, so if two people open the same image at the same moment, the
// second transaction automatically retries against the first one's result
// instead of overwriting it.
export async function damageMemory(id, visitorName) {
  const memoryRef = doc(db, COLLECTION_NAME, id);
  let updatedData;

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(memoryRef);
    const current = snapshot.data();

    const damageCount = current.fragile ? FRAGILE_DAMAGE_PER_VIEW : DAMAGE_PER_VIEW;
    const { base64, changed } = await damageImage(current.base64, damageCount);

    const changes = {
      base64,
      lastChanged: changed,
      views: (current.views || 0) + 1,
      lastViewedBy: visitorName,
      updatedAt: serverTimestamp(),
    };

    transaction.update(memoryRef, changes);
    updatedData = { ...current, ...changes };
  });

  return updatedData;
}

// Save an AI-restored image as the new version of a memory. From this point
// on the memory is "fragile" (no restart markers survive the AI round-trip),
// so future views will damage it just one character at a time instead of five.
export async function restoreMemory(id, restoredBase64) {
  const memoryRef = doc(db, COLLECTION_NAME, id);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(memoryRef);
    const current = snapshot.data();

    transaction.update(memoryRef, {
      base64: restoredBase64,
      fragile: true,
      restorations: (current.restorations || 0) + 1,
      lastChanged: [], // a restoration isn't a per-character corruption
      updatedAt: serverTimestamp(),
    });
  });
}
