import type { Room } from "./types";

/**
 * In Mr White mode, the first clue of a round gives Mr White a special
 * opportunity (the broad theme hint). Do not let the random order repeatedly
 * make Mr White start the round. When the first player is Mr White, swap them
 * with an alive civilian whenever one exists. This is applied server-side so
 * every client sees the same fair order.
 */
export function ensureFairMrWhiteStart(room: Room) {
  if (room.settings.mode !== "mrwhite" || !room.game) return;
  if (room.game.phase !== "clue" && room.game.phase !== "tiebreak-clue") return;
  if (room.game.turnIndex !== 0) return;

  const firstId = room.game.order[0];
  const first = room.players.find((p) => p.id === firstId);
  if (!first || first.role !== "infiltrator") return;

  const civilianIndex = room.game.order.findIndex((id) => {
    const player = room.players.find((p) => p.id === id);
    return Boolean(player && player.role === "civil" && !player.isEliminated && !player.isSpectator && player.connected);
  });

  if (civilianIndex <= 0) return;
  [room.game.order[0], room.game.order[civilianIndex]] = [room.game.order[civilianIndex], room.game.order[0]];
}
