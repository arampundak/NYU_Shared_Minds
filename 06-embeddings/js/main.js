// main.js — write a thought, embed it, save it as a room, list the 5 nearest
// rooms by cosine similarity, paint the room, then walk in it and go through
// its doors to other rooms.

import { embedText, nearest } from "./embed.js";
import { nearDoor, bridgeDoor, compassDoor } from "./doors.js";
import { getPlayer, savePlayer, saveRoom, loadRooms, saveRoomImage, loadRoomImage, incrementVisits } from "./rooms.js";
import { paintRoom } from "./paint.js";
import { showRoomImage, setDoorHandler } from "./roomview.js";
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

// Walk into a room: show its painting, count the visit, say whose thought it is.
async function enterRoom(room) {
  currentRoom = room;
  compassForm.hidden = true;
  showRoomImage(await loadRoomImage(room.id));
  roomSection.hidden = false;
  statusEl.textContent = `"${room.text}" — ${room.authorName}${room.isBot ? " (bot)" : ""}. Click the floor to walk, or click a door.`;
  incrementVisits(room.id).catch((error) => console.warn("couldn't count the visit", error));
}

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
    statusEl.textContent = "Embedding your thought...";
    const embedding = await embedText(text);

    // Look at the existing rooms before saving, so you never match yourself.
    statusEl.textContent = "Finding your place among the other rooms...";
    const rooms = await loadRooms();
    const neighbours = nearest(embedding, rooms, 5);

    const roomId = await saveRoom({ text, embedding, authorName: name, authorId: player.id });
    showNeighbours(neighbours);
    thoughtInput.value = "";

    const thisRoom = { id: roomId, text, embedding, authorName: name, isBot: false };

    // Walk in as soon as the scene is painted; the door pass finishes behind it.
    let entered = Promise.resolve();
    const base64 = await paintRoom(
      text,
      (message) => { statusEl.textContent = message; },
      (sceneBase64) => {
        entered = saveRoomImage(roomId, sceneBase64).then(() => enterRoom(thisRoom));
        entered.catch((error) => console.error(error));
      }
    );
    await entered;
    await saveRoomImage(roomId, base64);
    // Swap in the version with painted doors, unless you've already left.
    if (currentRoom && currentRoom.id === roomId) await showRoomImage(base64);
  } catch (error) {
    console.error(error);
    statusEl.textContent = `Something went wrong: ${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
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
