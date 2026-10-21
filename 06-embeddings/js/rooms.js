// rooms.js — reading and writing the `rooms` collection in Firestore.

import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, query, where, doc, setDoc, getDoc, updateDoc, increment, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const PLAYER_KEY = "doors-player";

// Player identity: a random id plus a name, kept in localStorage. No auth.
export function getPlayer() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYER_KEY));
    if (saved && saved.id) return { found: [], questObjectId: null, ...saved };
  } catch {}
  const player = { id: crypto.randomUUID(), name: "", found: [], questObjectId: null };
  savePlayer(player);
  return player;
}

export function savePlayer(player) {
  localStorage.setItem(PLAYER_KEY, JSON.stringify(player));
}

export async function saveRoom({ text, embedding, authorName, authorId, isBot = false }) {
  const ref = await addDoc(collection(db, "rooms"), {
    text, embedding, authorName, authorId, isBot,
    objectId: null, visits: 0, visitorClusters: [],
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function loadRooms() {
  const snapshot = await getDocs(collection(db, "rooms"));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Images live in their own collection (same id as the room) so loading all
// the rooms for similarity search stays light.
export async function saveRoomImage(roomId, base64) {
  await setDoc(doc(db, "roomImages", roomId), { base64 });
}

export async function loadRoomImage(roomId) {
  const snapshot = await getDoc(doc(db, "roomImages", roomId));
  return snapshot.exists() ? snapshot.data().base64 : null;
}

export async function incrementVisits(roomId) {
  await updateDoc(doc(db, "rooms", roomId), { visits: increment(1) });
}

// The ids of the rooms this player wrote.
export async function loadOwnRoomIds(playerId) {
  const snapshot = await getDocs(query(collection(db, "rooms"), where("authorId", "==", playerId)));
  return new Set(snapshot.docs.map((d) => d.id));
}

// Mirror the player's quest progress into Firestore. Called only when the
// quest or the found list changes, never per frame.
export async function savePlayerDoc(player) {
  await setDoc(
    doc(db, "players", player.id),
    {
      name: player.name,
      found: player.found,
      questObjectId: player.questObjectId,
      lastSeen: serverTimestamp(),
    },
    { merge: true }
  );
}
