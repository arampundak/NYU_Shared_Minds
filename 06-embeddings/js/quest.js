// quest.js — which object is the player looking for?

// A random placed object the player hasn't found and that isn't in a room
// they wrote themselves. `ownRoomIds` is a Set of the player's room ids.
export function pickQuest(player, objects, ownRoomIds) {
  const candidates = objects.filter(
    (object) =>
      object.placedInRoomId &&
      !player.found.includes(object.id) &&
      !ownRoomIds.has(object.placedInRoomId)
  );
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
