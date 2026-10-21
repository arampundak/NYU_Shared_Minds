# Doors of Perception — SPEC

Shared Minds, Week 6 ("Handles in Hyperspace"). Folder: `06-embeddings/` in the NYU_Shared_Minds repo.

## How to work with this spec (read first, Claude Code)

- Build **only the stage I ask for**. Don't start the next stage.
- After each stage, tell me exactly how to test it in the browser.
- Plain HTML + vanilla JS ES modules, no build step, no framework. Libraries come from a CDN.
- Reuse the patterns in `04-every-time-you-look/js/` (`replicate.js`, `firebase.js`, `seed.js`).
- Keep files small: one module per concern.

## The idea in one line

A Monkey Island–style point-and-click world where **every room is someone's written thought**. Rooms are placed in embedding space, doors lead to neighbours *by meaning*, and you search for hidden objects by steering through meaning, not by swiping a feed.

## Brief → feature map

| Brief | Feature |
|---|---|
| "When everyone is a producer, search becomes king" | The object quest: you search by steering doors through meaning |
| More dimensions than up/down/left/right | Three doors: near, bridge, compass (embedding arithmetic) |
| Better than polarizing bubbles | Bridge door leads to far-away rooms visited from different clusters |
| God button + embeddings | Bot personas write thoughts through the same pipeline, labelled as bots |
| UMAP: 1000D on a laptop | Map of all rooms, openable anytime |
| Navigation by creation | Writing your thought *is* your entry point and position in the space |

## User journey

1. **Arrive.** Enter a name and take a selfie with the webcam. Nano-banana turns it into a Monkey Island–style cartoon character.
2. **Write one thought**, e.g. "a flooded library where the candles still burn." Thoughts are fixed once written (no editing).
3. **Wait screen = the map.** The embedding returns first, so the UMAP map shows your dot flying to where your thought landed, with nearest rooms lighting up. Meanwhile the room is painted.
4. **Your room appears.** A wide side-view painting. Your character stands on the floor strip. You get a **quest card**: "Find the rusty key."
5. **Click to walk** along the floor. Click a door to go through it:
   - **Near door:** nearest room by cosine similarity.
   - **Bridge door:** a far-away room that's popular across clusters.
   - **Compass door:** type a word ("old, locked, metal"), and it takes you to the room nearest *your current room + that word*.
6. **Other players are visible live**, walking in the same room.
7. **Find the object.** Click the sparkle in the right room, mark it found, get a new quest. Score = objects found.
8. **Map button, anytime.** Shows all rooms and your position. **No teleporting**: doors are the only way to move.

## Tech stack

- **Hosting:** GitHub Pages (existing workflow).
- **Database:** Firebase **Firestore**, existing project `aramp-shared-minds`, free Spark plan. **No Firebase Storage**: images go into Firestore as base64.
- **AI:** class Replicate proxy `https://itp-ima-replicate-proxy.web.app/api/create_n_get` (POST `{model, input}`, same as week 4). No API key in the client.
- **CORS for images:** `https://images.weserv.nl/?url=` (as in week 4) before drawing Replicate images on a canvas.
- **UMAP:** `umap-js` from a CDN, computed in the browser.

### Models (Stage 1 verifies each one works through the proxy; swap if not)

| Job | First choice | Notes |
|---|---|---|
| Text embedding | `krthr/clip-embeddings` | Returns a vector for text. Fallback: `replicate/all-mpnet-base-v2` |
| Room painting | `black-forest-labs/flux-schnell` | Fast. 16:9 |
| Selfie → avatar | `google/nano-banana` | `image_input: [dataURL]`, already working in week 4 |
| Bot thoughts | `meta/meta-llama-3-8b-instruct` | Any small chat LLM the proxy allows |

**Locked style prompt** (append to every room prompt):
`hand-painted 1990s cartoon point-and-click pirate adventure game background, bold saturated colors, thick whimsical shapes, exaggerated perspective, open scene seen straight on, wide open flat ground across the bottom third, no ceiling, no walls, no pillars or objects at the left and right edges, no characters, no text, no title, no logo, no signature`

## Data model (Firestore)

Split metadata from images so loading all rooms stays light.

**`rooms/{roomId}`**
```
text, embedding: number[], authorName, authorId, isBot: bool,
objectId: string|null, visits: number, visitorClusters: string[] (optional),
createdAt
```

**`roomImages/{roomId}`**: `{ base64 }` (JPEG, shrunk to about 768×432 on a canvas, well under the 1 MB doc limit)

**`players/{playerId}`**: `{ name, avatarBase64, roomId, x, targetX, lastSeen, found: string[], questObjectId }`

**`objects/{objectId}`**: `{ name, embedding, placedInRoomId|null }`. Seeded once from a list of about 20 objects (rusty key, brass compass, broken watch, love letter, seashell, candle stub, map fragment, toy boat, ...).

Player identity: a random id plus name saved in `localStorage`. No auth.

## Core logic

- **Similarity:** cosine similarity, brute-force in the browser over all rooms (fine for a few hundred).
- **Near door:** highest cosine, excluding the current room.
- **Compass door:** embed the typed word(s); target = normalize(currentVec + 0.6 × wordVec); go to the nearest room to the target, excluding the current one.
- **Bridge door (simple version):** among the bottom 30% by cosine to the current room, pick the one with the most `visits`.
- **Object placement (meaning-based):** when a room is created, compare its embedding to every *unplaced* object; if the best cosine is above a threshold (tune, start about 0.2 for CLIP text), set `room.objectId` and `object.placedInRoomId`. The object is drawn as a code-made sparkle at a random x on the floor strip, plus its name on hover.
- **Quest:** a random placed object the player hasn't found and that isn't in their own room. Show only the object's name, never its location. Objects stay put, so everyone can find each one.
- **Walking:** the floor is a fixed strip (bottom 38% of the room image). Clicking sets `targetX`, and the character slides to it. Doors are code-drawn on top of the painting: left edge, right edge, back center.
- **Presence:** write `roomId` and `targetX` **only on click or room change** (not per frame), and a `lastSeen` heartbeat every 20 s. Others animate locally to `targetX`. Hide players with `lastSeen` over 60 s. This keeps us inside Spark's daily write limits.

## Stages

Commit after each one works. Timings assume things go smoothly; Stages 1–5 are the must-have game.

1. **Thought → space (≈25 min).** Text box → embedding via proxy → save to `rooms` → list the 5 nearest rooms with cosine scores. Verify all four models answer through the proxy (one test call each, logged to the console).
2. **Room + walking (≈25 min).** Paint the room with flux-schnell, shrink to base64, save to `roomImages`, draw it. A placeholder character click-walks on the floor strip.
3. **Doors (≈20 min).** Near, compass and bridge doors working; entering a room increments `visits`.
4. **Objects + quest (≈20 min).** Seed `objects` with embeddings, meaning-based placement on room creation, sparkle, quest card, found list and score.
5. **God button + bots (≈20 min).** A `bots.html` page with 6 distinct personas: the LLM writes a thought, which goes through the exact same pipeline with `isBot: true` and a visible "bot" label. One button seeds about 30 rooms before the demo.
6. **Map + wait screen (≈15 min).** UMAP of all room embeddings; your dot animates in while the room paints. Map button anytime, no click-to-teleport.
7. **Selfie avatar (≈15 min).** Webcam capture → nano-banana → cartoon character → `players.avatarBase64`.
8. **Live presence (≈20 min).** Other players walking in your room, per the presence rules above.

**If time runs out, cut from the bottom:** presence, then avatar, then map polish. Stages 1–5 must work for the demo.

## Out of scope (don't build)

Editing thoughts, auth/login, chat, blended hallways, combat, inventory beyond the found list, moderation beyond the style prompt.

## Known risks

- **Proxy model support:** Stage 1 checks this before anything else.
- **Replicate URLs expire:** always convert to base64 immediately.
- **CORS on canvas:** use the weserv proxy.
- **Generation failures:** retry with backoff, as in week 4's `MAX_ATTEMPTS`.
- **Spark write limits:** follow the presence rules.
- **Two rooms claiming the same object at once:** use a Firestore transaction for placement.
