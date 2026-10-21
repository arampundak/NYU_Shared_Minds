// pipeline.js — the one way a thought becomes a room. Players (main.js) and
// bots (bots.js) both go through this, so a bot's room is built exactly like
// yours, just with isBot set.
//
// embed -> save room -> give it a hidden object if one fits -> paint the scene
// -> save it -> paint the doors in -> save that.
//
// Hooks (all optional) let the caller show progress:
//   onStatus(message)               progress and retry messages
//   onEmbedded(embedding)           before the room exists (find neighbours here)
//   onSaved(roomId, embedding)      right after the room is saved
//   onSceneSaved(roomId, embedding) the first painting is saved (walk in now)

import { embedText } from "./embed.js";
import { saveRoom, saveRoomImage } from "./rooms.js";
import { placeObjectInRoom } from "./objects.js";
import { paintRoom } from "./paint.js";

export async function createRoom({ text, authorName, authorId, isBot = false }, hooks = {}) {
  const {
    onStatus = () => {},
    onEmbedded = async () => {},
    onSaved = async () => {},
    onSceneSaved = async () => {},
  } = hooks;

  onStatus("Embedding the thought...");
  const embedding = await embedText(text);
  await onEmbedded(embedding);

  const roomId = await saveRoom({ text, embedding, authorName, authorId, isBot });

  // Give the room a hidden object if one fits its meaning.
  let placedObject = null;
  try {
    placedObject = await placeObjectInRoom(roomId, embedding);
  } catch (error) {
    console.warn("couldn't place an object", error);
  }
  await onSaved(roomId, embedding);

  let sceneSaved = Promise.resolve();
  const base64 = await paintRoom(text, onStatus, (sceneBase64) => {
    sceneSaved = saveRoomImage(roomId, sceneBase64).then(() => onSceneSaved(roomId, embedding));
    sceneSaved.catch((error) => console.error(error));
  });
  await sceneSaved;
  await saveRoomImage(roomId, base64);

  return { roomId, embedding, base64, placedObject };
}
