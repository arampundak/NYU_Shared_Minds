// main.js — write a thought, embed it, save it as a room, list the 5 nearest
// rooms by cosine similarity, paint the room, then walk in it and go through
// its doors to other rooms.

import { nearest } from "./embed.js";
import { createRoom } from "./pipeline.js";
import { nearDoor, bridgeDoor, compassDoor } from "./doors.js";
import { getPlayer, savePlayer, loadRooms, loadRoomImage, incrementVisits,
  loadOwnRoomIds, savePlayerDoc } from "./rooms.js";
import { showRoomImage, setDoorHandler, setObjectHandler, setRoomObject } from "./roomview.js";
import { loadObjects, seedObjects } from "./objects.js";
import { pickQuest } from "./quest.js";
import { celebrate } from "./celebration.js";
import { verifyModels } from "./modelcheck.js";

const form = document.getElementById("thought-form");
const nameInput = document.getElementById("name");
const thoughtInput = document.getElementById("thought");
const submitButton = document.getElementById("submit");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const roomSection = document.getElementById("room");
const compassForm = document.getElementById("compass-form");
const compassInput = document.getElementById("compass-words");
const questText = document.getElementById("quest-text");
const questScore = document.getElementById("quest-score");
const seedButton = document.getElementById("seed");
const seedStatus = document.getElementById("seed-status");
const verifyButton = document.getElementById("verify");
const verifyList = document.getElementById("verify-list");

const player = getPlayer();
nameInput.value = player.name;

function el(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showNeighbours(neighbours) {
  resultsEl.replaceChildren();
  if (!neighbours.length) {
    resultsEl.append(el("p", "You're the first room. Write another thought from a different tab to see neighbours."));
    return;
  }
  const list = document.createElement("ol");
  for (const { room, score } of neighbours) {
    const item = document.createElement("li");
    item.append(
      el("span", score.toFixed(3), "score"),
      el("span", room.text, "text"),
      el("span", ` — ${room.authorName}${room.isBot ? " (bot)" : ""}`, "author")
    );
    list.append(item);
  }
  resultsEl.append(el("h2", "Nearest rooms"), list);
}

let currentRoom = null;
let objectHere = null; // the hidden object in the current room, if you haven't found it

function saveProgress() {
  savePlayer(player);
  savePlayerDoc(player).catch((error) => console.warn("couldn't save progress", error));
}

function showQuest(objects) {
  const quest = objects.find((object) => object.id === player.questObjectId);
  questText.textContent = quest
    ? `Quest: find the ${quest.name}`
    : "No quest yet. Objects turn up as more rooms are written.";
  const names = player.found.map((id) => id.replace(/-/g, " "));
  questScore.textContent = `Found ${player.found.length}${names.length ? `: ${names.join(", ")}` : ""}`;
}

// Keep the current quest if it's still open, otherwise pick a new one.
async function ensureQuest(objects) {
  const open = objects.find(
    (object) => object.id === player.questObjectId && object.placedInRoomId && !player.found.includes(object.id)
  );
  if (!open) {
    const next = pickQuest(player, objects, await loadOwnRoomIds(player.id));
    player.questObjectId = next ? next.id : null;
    saveProgress();
  }
  showQuest(objects);
  return objects.find((object) => object.id === player.questObjectId) || null;
}

// Walk into a room: show its painting, count the visit, say whose thought it is.
async function enterRoom(room) {
  currentRoom = room;
  compassForm.hidden = true;
  const [image, objects] = await Promise.all([loadRoomImage(room.id), loadObjects()]);
  await showRoomImage(image);
  objectHere = objects.find((o) => o.placedInRoomId === room.id && !player.found.includes(o.id)) || null;
  setRoomObject(room.id, objectHere);
  roomSection.hidden = false;
  statusEl.textContent = `"${room.text}" — ${room.authorName}${room.isBot ? " (bot)" : ""}. Click the floor to walk, or click a door.`;
  incrementVisits(room.id).catch((error) => console.warn("couldn't count the visit", error));
  await ensureQuest(objects);
}

setObjectHandler(async () => {
  if (!objectHere) return;
  if (objectHere.id !== player.questObjectId) {
    statusEl.textContent = `A ${objectHere.name}. Not what you're looking for.`;
    return;
  }
  const found = objectHere;
  player.found.push(found.id);
  statusEl.textContent = `You found the ${found.name}!`;
  objectHere = null;
  setRoomObject(null, null);
  player.questObjectId = null;
  const next = await ensureQuest(await loadObjects());
  celebrate({ objectName: found.name, score: player.found.length, nextQuest: next ? next.name : null });
});

async function goThrough(target, noRoomMessage) {
  if (!target) {
    statusEl.textContent = noRoomMessage;
    return;
  }
  await enterRoom(target);
}

setDoorHandler(async (doorId) => {
  try {
    if (doorId === "compass") {
      compassForm.hidden = false;
      compassInput.focus();
      statusEl.textContent = "Type a word or two, and the compass will steer you.";
      return;
    }
    const rooms = await loadRooms();
    const none = "There's no other room yet. Write another thought first.";
    if (doorId === "near") await goThrough(nearDoor(currentRoom, rooms), none);
    else await goThrough(bridgeDoor(currentRoom, rooms), none);
  } catch (error) {
    console.error(error);
    statusEl.textContent = `Something went wrong: ${error.message}`;
  }
});

compassForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const words = compassInput.value.trim();
  if (!words) return;
  compassForm.hidden = true;
  compassInput.value = "";
  try {
    statusEl.textContent = `Steering toward "${words}"...`;
    const rooms = await loadRooms();
    await goThrough(
      await compassDoor(currentRoom, words, rooms),
      "There's no other room yet. Write another thought first."
    );
  } catch (error) {
    console.error(error);
    statusEl.textContent = `Something went wrong: ${error.message}`;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = thoughtInput.value.trim();
  const name = nameInput.value.trim();
  if (!text || !name) return;

  player.name = name;
  savePlayer(player);
  submitButton.disabled = true;

  try {
    let neighbours = [];
    let roomId = null;
    const { base64 } = await createRoom(
      { text, authorName: name, authorId: player.id },
      {
        onStatus: (message) => { statusEl.textContent = message; },
        // Look at the existing rooms before saving, so you never match yourself.
        onEmbedded: async (embedding) => {
          statusEl.textContent = "Finding your place among the other rooms...";
          neighbours = nearest(embedding, await loadRooms(), 5);
        },
        onSaved: (id) => {
          roomId = id;
          showNeighbours(neighbours);
          thoughtInput.value = "";
        },
        // Walk in as soon as the scene is painted; the door pass finishes behind it.
        onSceneSaved: (id, embedding) =>
          enterRoom({ id, text, embedding, authorName: name, isBot: false }),
      }
    );
    // Swap in the version with painted doors, unless you've already left.
    if (currentRoom && currentRoom.id === roomId) await showRoomImage(base64, { keepPosition: true });
  } catch (error) {
    console.error(error);
    statusEl.textContent = `Something went wrong: ${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
});

seedButton.addEventListener("click", async () => {
  seedButton.disabled = true;
  seedStatus.textContent = "Seeding...";
  try {
    const added = await seedObjects((done, total) => {
      seedStatus.textContent = `Seeding ${done}/${total}...`;
    });
    seedStatus.textContent = added ? `Added ${added} objects.` : "All objects were already there.";
  } catch (error) {
    console.error(error);
    seedStatus.textContent = `Failed: ${error.message}`;
  }
  seedButton.disabled = false;
});

verifyButton.addEventListener("click", async () => {
  verifyButton.disabled = true;
  verifyList.replaceChildren(el("li", "Running... (can take a minute)"));
  const rows = [];
  await verifyModels((result) => {
    rows.push(result);
    verifyList.replaceChildren(
      ...rows.map((r) => el("li", `${r.ok ? "✓" : "✗"} ${r.name} — ${r.detail}`, r.ok ? "ok" : "fail"))
    );
  });
  verifyButton.disabled = false;
});
