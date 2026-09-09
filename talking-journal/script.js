/* ============================================================
   A Journal That Talks Back
   NYU ITP — Shared Minds

   NOTE ON AUTHORSHIP: this starter was AI-assisted. The initial
   scaffold (HTML structure, CSS, and this script) was generated
   with Claude Code and then reviewed and edited by hand.

   There is no AI or language model running in this file. Every
   reply below is chosen by a handful of if-statements and a
   random pick from a fixed list of sentences I wrote. That is
   the point of the piece, not a placeholder for something
   smarter later.

   HOW IT FLOWS:
     you press Enter
       -> handleSubmit()        reads + clears the textarea
       -> appendEntry()         puts your line in the document
       -> showThinking()        the dot appears
       -> (400-800ms pause)
       -> generateReply()       decides what to say, or nothing
       -> appendReply()         or just fades the dot out
   ============================================================ */


/* ------------------------------------------------------------
   1. TUNING
   The two dice rolls, in one place so they're easy to change.
   ------------------------------------------------------------ */

const SILENCE_CHANCE = 0.15;   // 15% of the time it says nothing
const ECHO_CHANCE    = 0.30;   // 30% of the time it echoes a word

const PAUSE_MIN = 400;         // milliseconds
const PAUSE_MAX = 800;

const SHORT_ENTRY = 4;         // under this many words -> "prod"
const LONG_ENTRY  = 20;        // over this many words  -> "weighty"


/* ------------------------------------------------------------
   2. THE REPLY BANKS
   Four moods. Which one gets used is decided by pickBank().
   ------------------------------------------------------------ */

const BANKS = {
  // Your line ended in a question mark.
  question: [
    "Why do you think that?",
    "What if it isn't?",
    "Are you sure?",
    "What would change your mind?",
    "Who are you asking?",
    "You might already know that one."
  ],

  // Your line was very short.
  prod: [
    "Say more.",
    "Keep going.",
    "And?",
    "What else?",
    "Finish the thought.",
    "That's not all of it."
  ],

  // Your line was long.
  weighty: [
    "That's a lot to hold at once.",
    "Sit with that for a second.",
    "That came out all in one piece.",
    "Somewhere in there is the part that matters.",
    "Take a breath. It'll still be there.",
    "Which part of that is the real one?"
  ],

  // Everything else.
  general: [
    "This is interesting, what else?",
    "Go on.",
    "Noted.",
    "Keep writing.",
    "Okay. Then what?",
    "Fair enough."
  ]
};

// The ELIZA move: one word of yours, handed back to you.
// "%s" gets swapped for the word.
const ECHO_TEMPLATES = [
  "What does '%s' bring up for you?",
  "Tell me about '%s'.",
  "Why '%s'?",
  "You said '%s'. Is that the right word?",
  "Stay on '%s' for a minute."
];

// Words too common to be worth echoing back.
const STOPWORDS = new Set([
  "the", "and", "but", "for", "not", "you", "your", "yours", "was", "were",
  "are", "its", "it's", "that", "this", "these", "those", "with", "from",
  "have", "has", "had", "been", "being", "just", "like", "them", "they",
  "their", "there", "then", "than", "what", "when", "where", "who", "why",
  "how", "will", "would", "could", "should", "can", "cant", "can't", "dont",
  "don't", "didn't", "didnt", "about", "into", "over", "some", "any", "all",
  "get", "got", "one", "out", "now", "very", "really", "much", "more",
  "because", "here", "him", "her", "his", "she", "hers", "our", "ours",
  "which", "while", "also", "even", "still", "too", "yes", "yet", "own",
  "off", "two", "say", "does", "did", "doesn't", "doesnt", "i'm", "im",
  "i've", "ive", "let", "made", "make", "many", "most", "only", "same",
  "such", "were", "why's", "him", "may", "might", "must",
  // low-value filler — technically content words, but dull to echo
  "actually", "probably", "maybe", "something", "anything", "everything",
  "going", "happened", "seems", "kind", "sort", "well"
]);


/* ------------------------------------------------------------
   3. CHOOSING A REPLY
   Four small functions. Each one answers a single question.
   ------------------------------------------------------------ */

// Split a string into words. Used for counting and for echoing.
function words(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

// Which bank fits this line? Checked in order — first match wins.
function pickBank(text) {
  const trimmed = text.trim();
  const count = words(trimmed).length;

  if (trimmed.endsWith("?")) return "question";
  if (count < SHORT_ENTRY)   return "prod";
  if (count > LONG_ENTRY)    return "weighty";
  return "general";
}

// Remembers the last line used from each bank, so we never
// repeat the same sentence twice in a row within that bank.
const lastUsed = {};

function pickLine(bankName) {
  const bank = BANKS[bankName];
  let line;

  // Re-roll until we get something different from last time.
  // Safe because every bank has more than one line in it.
  do {
    line = bank[Math.floor(Math.random() * bank.length)];
  } while (line === lastUsed[bankName]);

  lastUsed[bankName] = line;
  return line;
}

// Pull one interesting word out of what was typed.
// Deliberately crude: lowercase, strip punctuation, drop the
// stopwords and anything short, pick at random from the rest.
// Returns null if nothing survives — the caller then falls back
// to a normal bank line.
function pickContentWord(text) {
  const candidates = text
    .toLowerCase()
    .split(/[^a-z']+/)                       // split on non-letters
    .map(w => w.replace(/^'+|'+$/g, ""))     // trim stray quotes
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// The decision itself. Returns a string, or null for silence.
function generateReply(text) {
  // Roll 1: say nothing at all.
  if (Math.random() < SILENCE_CHANCE) return null;

  // Roll 2: echo a word back, if there's one worth echoing.
  if (Math.random() < ECHO_CHANCE) {
    const word = pickContentWord(text);
    if (word) {
      const template =
        ECHO_TEMPLATES[Math.floor(Math.random() * ECHO_TEMPLATES.length)];
      return template.replace("%s", word);
    }
    // No usable word — quietly fall through to a bank line.
  }

  // Otherwise: a line from whichever bank fits.
  return pickLine(pickBank(text));
}


/* ------------------------------------------------------------
   4. WRITING TO THE PAGE
   Everything below here only touches the DOM.
   ------------------------------------------------------------ */

const page     = document.getElementById("page");
const log      = document.getElementById("log");
const composer = document.getElementById("composer");

function appendEntry(text) {
  const p = document.createElement("p");
  p.className = "entry";
  p.textContent = text;          // textContent, not innerHTML — no
  log.appendChild(p);            // typed markup can ever execute
}

function appendReply(text) {
  const p = document.createElement("p");
  p.className = "reply";
  p.textContent = text;
  log.appendChild(p);
}

// The dot. Created empty, faded in, and later either replaced by
// a reply or faded back out with nothing behind it.
function showThinking() {
  const wrap = document.createElement("div");
  wrap.className = "thinking";
  wrap.innerHTML = '<span class="dot"></span>';
  log.appendChild(wrap);

  // Next frame, so the browser registers the opacity transition.
  requestAnimationFrame(() => wrap.classList.add("visible"));
  return wrap;
}

function hideThinking(wrap) {
  wrap.classList.remove("visible");
  // Wait for the fade to finish before removing the element.
  setTimeout(() => wrap.remove(), 260);
}

// Keep the cursor in view as the document grows — but only when it
// actually needs it. Scrolling to the bottom of the body would leap
// past your text to the bottom of the blank sheet, since the page has
// a fixed minimum height. So: measure where the composer sits, and if
// it's still comfortably on screen, don't move at all.
function keepCursorInView() {
  const margin = 80;                       // breathing room below the line
  const bottom = composer.getBoundingClientRect().bottom;
  const overflow = bottom + margin - window.innerHeight;

  if (overflow > 0) {
    window.scrollBy({ top: overflow, behavior: "smooth" });
  }
}


/* ------------------------------------------------------------
   5. THE COMPOSER
   Auto-growing textarea; Enter submits, Shift+Enter newlines.
   ------------------------------------------------------------ */

function autoGrow() {
  composer.style.height = "auto";
  composer.style.height = composer.scrollHeight + "px";
}

function handleSubmit() {
  const text = composer.value.trim();
  if (!text) return;             // ignore empty Enters

  appendEntry(text);
  composer.value = "";
  autoGrow();
  keepCursorInView();

  const thinking = showThinking();
  const pause = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);

  setTimeout(() => {
    const reply = generateReply(text);
    hideThinking(thinking);

    if (reply !== null) {
      appendReply(reply);
      keepCursorInView();
    }
    // If reply is null we do nothing, and the pause just sits there.
  }, pause);
}

composer.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();      // stop the newline from being typed
    handleSubmit();
  }
});

composer.addEventListener("input", autoGrow);

// Clicking anywhere on the sheet puts the cursor back in the
// composer, so the whole page behaves like one writing surface.
page.addEventListener("mousedown", (event) => {
  if (event.target === composer) return;
  if (window.getSelection().toString()) return;   // allow text selection
  event.preventDefault();
  composer.focus();
});

// Start with the cursor already in the document.
composer.focus();
autoGrow();
