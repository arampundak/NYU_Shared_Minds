// seed.js — the logic behind seed.html's two buttons.

import { db } from "./firebase.js";
import {
  doc,
  setDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const COLLECTION_NAME = "memories";
const statusEl = document.getElementById("status");

function log(message) {
  statusEl.textContent += message + "\n";
}

// Reads prep/paintings.json and writes one Firestore document per image.
// base64 and original both start out identical to the freshly prepared JPEG.
document.getElementById("seed-button").addEventListener("click", async () => {
  statusEl.textContent = "";
  log("Reading prep/paintings.json...");

  const response = await fetch("prep/paintings.json");
  const paintings = await response.json();
  log(`Found ${paintings.length} images.`);

  for (const painting of paintings) {
    await setDoc(doc(db, COLLECTION_NAME, painting.id), {
      title: painting.title,
      source: painting.source,
      base64: painting.base64,
      original: painting.base64,
      views: 0,
      restorations: 0,
      fragile: false,
      lastViewedBy: null,
      updatedAt: null,
    });
    log(`  seeded ${painting.id} (${painting.title})`);
  }

  log("Done. All 9 memories are seeded.");
});

// Resets every memory back to its untouched "original" JPEG, and zeroes out
// its stats. Useful between classroom demos.
document.getElementById("reset-button").addEventListener("click", async () => {
  statusEl.textContent = "";
  log("Reading prep/paintings.json for the list of ids...");

  const response = await fetch("prep/paintings.json");
  const paintings = await response.json();

  for (const painting of paintings) {
    const ref = doc(db, COLLECTION_NAME, painting.id);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
      log(`  ${painting.id}: not seeded yet, skipping`);
      continue;
    }

    const current = snapshot.data();
    await setDoc(ref, {
      ...current,
      base64: current.original,
      views: 0,
      restorations: 0,
      fragile: false,
      lastViewedBy: null,
      updatedAt: null,
    });
    log(`  reset ${painting.id}`);
  }

  log("Done. Every memory is back to its original state.");
});
