// main.js — wires up index.html: the grid, the overlay, and the clicks.

import {
  subscribeToAllMemories,
  subscribeToOneMemory,
  damageMemory,
} from "./memories.js";
import { requestRestoration } from "./replicate.js";

// The order the 9 photos appear in the grid. Matches prep/paintings.json.
const MEMORY_ORDER = [
  "astronaut",
  "kodim23",
  "kodim19",
  "kodim05",
  "kodim04",
  "kodim15",
  "kodim09",
  "kodim03",
  "kodim12",
];

// ---- who's looking? --------------------------------------------------------

function getVisitorName() {
  const stored = localStorage.getItem("everyTimeYouLook.visitorName");
  if (stored) return stored;

  const name = prompt("Who's looking? (your name, for the album)") || "someone";
  localStorage.setItem("everyTimeYouLook.visitorName", name);
  return name;
}

const visitorName = getVisitorName();
document.getElementById("visitor-note").textContent = `Welcome, ${visitorName}.`;

// ---- the grid ---------------------------------------------------------------

const gridEl = document.getElementById("grid");
let latestMemories = {}; // id -> Firestore document data, kept up to date live

function renderGrid() {
  gridEl.innerHTML = "";

  for (const id of MEMORY_ORDER) {
    const memory = latestMemories[id];
    if (!memory) continue; // not seeded yet

    const tile = document.createElement("button");
    tile.className = "tile";
    tile.addEventListener("click", () => openOverlay(id));

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.style.backgroundImage = `url(data:image/jpeg;base64,${memory.base64})`;

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = memory.title;

    const meta = document.createElement("div");
    meta.className = "meta";
    const fragileNote = memory.fragile ? ` <span class="fragile-flag">fragile</span>` : "";
    meta.innerHTML =
      `${memory.views || 0} view${memory.views === 1 ? "" : "s"}` +
      (memory.lastViewedBy ? ` &middot; last looked at by ${escapeHtml(memory.lastViewedBy)}` : "") +
      fragileNote;

    tile.append(thumb, title, meta);
    gridEl.appendChild(tile);
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

subscribeToAllMemories((memoriesById) => {
  latestMemories = memoriesById;
  renderGrid();
});

// ---- the overlay --------------------------------------------------------

const overlayEl = document.getElementById("overlay");
const overlayImageEl = document.getElementById("overlay-image");
const overlayTitleEl = document.getElementById("overlay-title");
const overlaySourceEl = document.getElementById("overlay-source");
const overlayStatsEl = document.getElementById("overlay-stats");
const base64BoxEl = document.getElementById("base64-box");
const rememberButtonEl = document.getElementById("remember-button");
const rememberStatusEl = document.getElementById("remember-status");

let unsubscribeFromOpenMemory = null;
let openMemoryId = null;

async function openOverlay(id) {
  openMemoryId = id;
  overlayEl.hidden = false;
  rememberStatusEl.textContent = "";
  rememberButtonEl.disabled = false;

  // Show whatever we already have while the damage transaction runs.
  renderOverlayContent(id, latestMemories[id]);

  // Stay live-updated while the overlay is open (in case someone else looks
  // at or restores this same memory while you're looking at it too).
  if (unsubscribeFromOpenMemory) unsubscribeFromOpenMemory();
  unsubscribeFromOpenMemory = subscribeToOneMemory(id, (memory) => {
    if (openMemoryId === id) renderOverlayContent(id, memory);
  });

  // Looking at it damages it — once per open — via a transaction, so two
  // visitors opening it at the same instant can't overwrite each other.
  await damageMemory(id, visitorName);
}

function closeOverlay() {
  overlayEl.hidden = true;
  openMemoryId = null;
  if (unsubscribeFromOpenMemory) {
    unsubscribeFromOpenMemory();
    unsubscribeFromOpenMemory = null;
  }
}

document.getElementById("overlay-close").addEventListener("click", closeOverlay);
overlayEl.addEventListener("click", (event) => {
  if (event.target === overlayEl) closeOverlay(); // click on the dark backdrop
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !overlayEl.hidden) closeOverlay();
});

function renderOverlayContent(id, memory) {
  if (!memory) return;

  overlayImageEl.src = `data:image/jpeg;base64,${memory.base64}`;
  overlayImageEl.alt = memory.title;
  overlayTitleEl.textContent = memory.title;
  overlaySourceEl.textContent = memory.source;

  const fragileNote = memory.fragile
    ? ` &middot; <span class="fragile-flag">fragile (AI-restored — damages fast now)</span>`
    : "";
  overlayStatsEl.innerHTML =
    `${memory.views || 0} view${memory.views === 1 ? "" : "s"} &middot; ` +
    `${memory.restorations || 0} restoration${memory.restorations === 1 ? "" : "s"}` +
    fragileNote;

  renderBase64Box(memory.base64, memory.lastChanged || []);
}

// Build the scrolling base64 text box, highlighting whichever character
// positions were just changed. We only wrap the *changed* characters in
// <span> elements and leave the rest as plain text, so this stays fast even
// for a 50,000-character string.
function renderBase64Box(base64, changedPositions) {
  base64BoxEl.innerHTML = "";
  const changedSet = new Set(changedPositions);
  const sorted = [...changedSet].sort((a, b) => a - b);

  let cursor = 0;
  let firstHighlightSpan = null;

  for (const position of sorted) {
    if (position > cursor) {
      base64BoxEl.appendChild(document.createTextNode(base64.slice(cursor, position)));
    }
    const span = document.createElement("span");
    span.className = "changed";
    span.textContent = base64[position];
    base64BoxEl.appendChild(span);
    if (!firstHighlightSpan) firstHighlightSpan = span;
    cursor = position + 1;
  }
  if (cursor < base64.length) {
    base64BoxEl.appendChild(document.createTextNode(base64.slice(cursor)));
  }

  if (firstHighlightSpan) {
    const boxRect = base64BoxEl.getBoundingClientRect();
    const spanRect = firstHighlightSpan.getBoundingClientRect();
    base64BoxEl.scrollTop += (spanRect.top - boxRect.top) - base64BoxEl.clientHeight / 2;
  } else {
    base64BoxEl.scrollTop = 0;
  }
}

// ---- the Remember button --------------------------------------------------

rememberButtonEl.addEventListener("click", async () => {
  const id = openMemoryId;
  if (!id) return;

  rememberButtonEl.disabled = true;
  rememberStatusEl.textContent = "remembering...";

  try {
    await requestRestoration(id, latestMemories[id].base64, (statusText) => {
      rememberStatusEl.textContent = statusText;
    });
    rememberStatusEl.textContent = "remembered — a little different now.";
  } catch (error) {
    console.error(error);
    // The AI model behind this is flaky and occasionally fails every retry
    // in a row — it's not broken, just unlucky. Clicking Remember again
    // almost always works.
    rememberStatusEl.textContent =
      `couldn't remember it this time (${error.message}) — the AI is a bit ` +
      `unreliable, try clicking Remember again.`;
  } finally {
    rememberButtonEl.disabled = false;
  }
});
