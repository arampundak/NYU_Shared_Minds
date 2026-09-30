// corruption.js — the "damage" that happens every time someone looks.
//
// A JPEG saved as base64 text is mostly a long string of random-looking
// characters. If we flip a handful of those characters to different random
// characters, the JPEG decoder gets confused at that point in the file and
// draws garbled pixels there — like static, or a photo left in the sun.
//
// Two rules keep this from destroying the image outright:
//  1. We never touch the HEADER_CHARS at the start. That's the part of the
//     file that says "this is a JPEG, here's its size, here's its color
//     table" — corrupt that and the whole image fails to load.
//  2. The original photos were saved with JPEG "restart markers" (see
//     prep/prepare.py). Those are checkpoints sprinkled through the file
//     that let the decoder recover after a corrupted byte, instead of
//     turning every pixel after it to noise. That's what keeps the damage
//     looking like local scratches instead of total static.

export const HEADER_CHARS = 900;          // never corrupt the first N characters
export const TAIL_CHARS = 4;              // never corrupt the last N characters
export const DAMAGE_PER_VIEW = 5;         // characters changed per normal view
export const FRAGILE_DAMAGE_PER_VIEW = 1; // characters changed per view once an
                                           // image has been AI-restored (no
                                           // restart markers, so it's more fragile)

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Pick a random base64 character that is NOT the one already there.
function randomDifferentChar(currentChar) {
  let next;
  do {
    next = BASE64_ALPHABET[Math.floor(Math.random() * BASE64_ALPHABET.length)];
  } while (next === currentChar);
  return next;
}

// Pick `count` unique random positions inside the "safe" middle zone of the
// string (after the header, before the tail).
function pickRandomPositions(stringLength, count) {
  const firstSafeIndex = HEADER_CHARS;
  const lastSafeIndex = stringLength - TAIL_CHARS; // exclusive
  const positions = new Set();
  const safeRange = lastSafeIndex - firstSafeIndex;

  while (positions.size < count && positions.size < safeRange) {
    const index = firstSafeIndex + Math.floor(Math.random() * safeRange);
    positions.add(index);
  }
  return Array.from(positions);
}

// Flip `count` random characters in `base64` to different random characters.
// Returns the new string plus the list of positions that changed.
function corruptOnce(base64, count) {
  const characters = base64.split("");
  const positions = pickRandomPositions(characters.length, count);

  for (const position of positions) {
    characters[position] = randomDifferentChar(characters[position]);
  }

  return { base64: characters.join(""), changed: positions };
}

// Check whether a base64 JPEG string still decodes as an image at all.
// (A few flipped characters almost always still decode fine — this is just
// a safety net for the rare case that ruins the file.)
function stillLoadsAsImage(base64) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = "data:image/jpeg;base64," + base64;
  });
}

// Damage a base64 JPEG string by `count` characters. If the result somehow
// fails to load as an image, try again with different random positions
// (up to `maxTries` times) rather than ever handing back a broken image.
export async function damageImage(base64, count, maxTries = 5) {
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const result = corruptOnce(base64, count);
    if (await stillLoadsAsImage(result.base64)) {
      return result;
    }
  }
  // Extremely unlikely with only a few characters changed, but if every
  // attempt broke the image, leave it untouched rather than break it.
  return { base64, changed: [] };
}
