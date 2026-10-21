// bots.js — the god button. Six personas each ask a small chat model for a
// thought, and every thought goes through the same pipeline as a player's
// (createRoom), only with isBot set.

import { runModel } from "./replicate.js";
import { createRoom } from "./pipeline.js";
import { loadRooms } from "./rooms.js";

const CHAT_MODEL = "meta/meta-llama-3-8b-instruct";
const PARALLEL_ROOMS = 3;

// Different places and moods, so the rooms spread out in embedding space.
export const PERSONAS = [
  { name: "Captain Brine", bio: "a grizzled pirate captain who thinks only of ships, salt, rum and buried treasure" },
  { name: "Madame Lull", bio: "an insomniac fortune teller who lives among candles, velvet curtains and tarot cards at midnight" },
  { name: "Pip the Tinker", bio: "a cheerful clockwork inventor whose mind is full of gears, steam, rust and half-built machines" },
  { name: "Sister Moss", bio: "a gentle gardener living in overgrown ruins, who notices plants, rain, stone and quiet" },
  { name: "Dr. Static", bio: "a paranoid radio technician surrounded by wires, antennas, glowing dials and lonely signals" },
  { name: "Little Gus", bio: "a ghost child who misses an old house: dusty toys, attic windows, sandcastles and summer afternoons" },
];

const logEl = document.getElementById("log");
const countInput = document.getElementById("count");
const goButton = document.getElementById("go");
const stopButton = document.getElementById("stop");
const progressEl = document.getElementById("progress");
const personaList = document.getElementById("personas");

for (const persona of PERSONAS) {
  const item = document.createElement("li");
  item.textContent = `${persona.name}: ${persona.bio}`;
  personaList.append(item);
}

function log(message, className) {
  const line = document.createElement("li");
  line.textContent = message;
  if (className) line.className = className;
  logEl.prepend(line);
}

// Llama answers with chatty extras ("Here is a thought:", quotes). Keep just
// the thought itself.
function cleanThought(raw) {
  let text = raw.trim().split("\n").find((line) => line.trim() && !/^here('s| is)\b.*:$/i.test(line.trim())) || "";
  text = text.replace(/^here('s| is)[^:]*:\s*/i, "").replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  return text.slice(0, 200);
}

async function writeThought(persona, avoid) {
  const avoidLine = avoid.length ? ` Do not repeat or closely resemble these: ${avoid.join(" | ")}.` : "";
  const prompt =
    `You are ${persona.name}, ${persona.bio}. ` +
    "Describe one single place in at most 20 words, as a vivid thought of your own. " +
    "Use concrete images: objects, light, weather, materials. " +
    `Reply with only the description: no quotation marks, no preamble, no list.${avoidLine}`;
  const output = await runModel(CHAT_MODEL, { prompt, max_tokens: 80, temperature: 1.0 });
  const thought = cleanThought(Array.isArray(output) ? output.join("") : String(output));
  if (thought.length < 8) throw new Error("the model gave an empty thought");
  return thought;
}

let stopping = false;

async function seed(total) {
  stopping = false;
  goButton.disabled = true;
  stopButton.disabled = false;

  // Spread the rooms evenly over the personas.
  const jobs = Array.from({ length: total }, (_, i) => PERSONAS[i % PERSONAS.length]);
  const written = new Map(PERSONAS.map((p) => [p.name, []]));
  let done = 0;
  let failed = 0;
  progressEl.textContent = `0 / ${total}`;

  async function worker() {
    while (jobs.length && !stopping) {
      const persona = jobs.shift();
      try {
        const thought = await writeThought(persona, written.get(persona.name).slice(-4));
        written.get(persona.name).push(thought);
        log(`${persona.name} (bot): "${thought}"`);
        const { placedObject } = await createRoom(
          { text: thought, authorName: persona.name, authorId: `bot-${persona.name.replace(/\W+/g, "-").toLowerCase()}`, isBot: true },
          { onStatus: () => {} }
        );
        done++;
        log(`  room built${placedObject ? `, hides a ${placedObject.name}` : ""}`, "ok");
      } catch (error) {
        failed++;
        console.error(error);
        log(`  ${persona.name} failed: ${error.message}`, "fail");
      }
      progressEl.textContent = `${done} / ${total}${failed ? ` (${failed} failed)` : ""}`;
    }
  }
  await Promise.all(Array.from({ length: PARALLEL_ROOMS }, worker));

  progressEl.textContent += stopping ? " — stopped" : " — finished";
  goButton.disabled = false;
  stopButton.disabled = true;
}

goButton.addEventListener("click", async () => {
  const total = Math.max(1, Math.min(60, Number(countInput.value) || 30));
  const existing = (await loadRooms()).filter((room) => room.isBot).length;
  log(`Starting: ${total} new bot rooms (${existing} already exist).`);
  seed(total);
});

stopButton.addEventListener("click", () => {
  stopping = true;
  progressEl.textContent += " — stopping after the rooms in progress...";
});
