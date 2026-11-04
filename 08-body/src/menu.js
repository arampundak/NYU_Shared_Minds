// start screen: name + room code. Picking a mode reloads the page with ?room= or ?solo, so every mode is a shareable URL.

const ADJECTIVES = ["swift", "amber", "quiet", "neon", "brave", "lucky", "rapid", "cobalt"];
const NOUNS = ["fox", "heron", "comet", "falcon", "otter", "lynx", "raven", "tiger"];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const randomRoom = () => `${pick(ADJECTIVES)}-${pick(NOUNS)}-${Math.floor(10 + Math.random() * 90)}`;
const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

export function getName() {
  try { return localStorage.getItem("duelName") || ""; } catch { return ""; }
}

export function showMenu() {
  const el = document.createElement("div");
  el.id = "menu";
  el.innerHTML = `
    <div id="menu-card">
      <h1>SO-100 DUEL</h1>
      <p>Fence a friend with a robot arm, using your whole upper body.<br>Sit about an arm's length back so both elbows and wrists are in the camera.</p>
      <label>your name <input id="menu-name" maxlength="12" placeholder="e.g. Ari" autocomplete="off"></label>
      <label>room code <input id="menu-room" maxlength="32" placeholder="type one, or create one" autocomplete="off"></label>
      <div id="menu-buttons">
        <button id="menu-join">Join room</button>
        <button id="menu-create">Create a room</button>
        <button id="menu-solo" class="quiet">Practice vs dummy</button>
      </div>
      <small>Your camera stays in your browser. Only joint angles are sent to your opponent.</small>
    </div>`;
  document.body.appendChild(el);

  const nameEl = el.querySelector("#menu-name"), roomEl = el.querySelector("#menu-room");
  nameEl.value = getName();
  try { roomEl.value = new URLSearchParams(location.search).get("code") ?? ""; } catch { /* ignore */ }

  const go = (query) => {
    try { localStorage.setItem("duelName", nameEl.value.trim().slice(0, 12)); } catch { /* storage blocked: name just won't persist */ }
    const url = new URL(location.href);
    url.search = query;
    location.href = url.href;
  };
  const join = (room) => { if (slug(room)) go(`?room=${encodeURIComponent(slug(room))}`); else roomEl.focus(); };

  el.querySelector("#menu-join").onclick = () => join(roomEl.value);
  el.querySelector("#menu-create").onclick = () => join(randomRoom());
  el.querySelector("#menu-solo").onclick = () => go("?solo");
  el.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") join(roomEl.value); });
  return el;
}
