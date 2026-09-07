import { NextRequest, NextResponse } from "next/server";
import type { Player, Room, Settings } from "@/lib/types";
import { addEvent, ackReveal, DEFAULT_SETTINGS, publicState, resetToLobby, startGame, submitClue, submitMrWhiteGuess, submitVote, updatePresenceAndTimers } from "@/lib/game";
import { createRoomIfFree, withRoomLock } from "@/lib/store";
import { clampInt, makeId, sanitizeCode, sanitizeName } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function newPlayer(name: string, joinOrder: number, spectator: boolean): Player {
  return {
    id: makeId(),
    token: `${makeId()}${makeId()}`,
    name,
    joinOrder,
    ready: false,
    connected: true,
    lastSeen: Date.now(),
    leaveSignaledAt: null,
    joinedMidGame: spectator,
    isSpectator: spectator,
    isEliminated: false,
    role: null,
    word: null,
    revealAck: false,
  };
}

async function readBody(req: NextRequest) {
  const text = await req.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function requireSession(body: any) {
  const code = sanitizeCode(body.code);
  const playerId = String(body.playerId ?? "");
  const token = String(body.token ?? "");
  if (!code || !playerId || !token) throw new Error("Session invalide.");
  return { code, playerId, token };
}

function findPlayer(room: Room, playerId: string, token: string) {
  const player = room.players.find((p) => p.id === playerId && p.token === token);
  if (!player) throw new Error("Session expirée ou invalide.");
  return player;
}

function resetReady(room: Room) {
  for (const p of room.players) p.ready = false;
}

function applySettings(room: Room, raw: Partial<Settings>) {
  const s = room.settings;
  if (raw.mode === "impostor" || raw.mode === "mrwhite") s.mode = raw.mode;
  s.roundsBeforeVote = clampInt(raw.roundsBeforeVote ?? s.roundsBeforeVote, 1, 4, 2);
  s.actionTimeSec = clampInt(raw.actionTimeSec ?? s.actionTimeSec, 15, 60, 30);
  if (typeof raw.keepCluesAfterVote === "boolean") s.keepCluesAfterVote = raw.keepCluesAfterVote;
  if (typeof raw.infiltratorsKnowEachOther === "boolean") s.infiltratorsKnowEachOther = raw.infiltratorsKnowEachOther;
  if (typeof raw.impostorKnowsRole === "boolean") s.impostorKnowsRole = raw.impostorKnowsRole;
  if (raw.wordSource === "random" || raw.wordSource === "custom") s.wordSource = raw.wordSource;
  if (typeof raw.customWordA === "string") s.customWordA = raw.customWordA.trim().slice(0, 40);
  if (typeof raw.customWordB === "string") s.customWordB = raw.customWordB.trim().slice(0, 40);

  if (s.mode === "mrwhite") {
    s.wordSource = "random";
    s.customWordA = "";
    s.customWordB = "";
  }
  if (s.mode === "impostor" && s.wordSource === "custom") {
    s.impostorKnowsRole = false;
    s.infiltratorsKnowEachOther = false;
  }
  if (s.mode === "impostor" && !s.impostorKnowsRole) {
    // Si les imposteurs ne savent pas qu'ils le sont, leur montrer leurs coéquipiers révélerait le rôle.
    s.infiltratorsKnowEachOther = false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const action = String(body.action ?? "");

    if (action === "create") {
      const name = sanitizeName(body.name);
      if (name.length < 2) throw new Error("Choisis un pseudo d'au moins 2 caractères.");
      const player = newPlayer(name, 1, false);
      let room: Room | null = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        const code = makeCode();
        const candidate: Room = {
          code,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "lobby",
          hostId: player.id,
          nextJoinOrder: 2,
          settings: { ...DEFAULT_SETTINGS },
          players: [player],
          game: null,
          events: [],
        };
        addEvent(candidate, `${name} a créé la room.`, "join");
        if (await createRoomIfFree(candidate)) {
          room = candidate;
          break;
        }
      }
      if (!room) throw new Error("Impossible de créer une room. Réessaie.");
      return NextResponse.json({ ok: true, session: { code: room.code, playerId: player.id, token: player.token, name }, state: publicState(room, player) });
    }

    if (action === "join") {
      const code = sanitizeCode(body.code);
      const name = sanitizeName(body.name);
      if (code.length !== 5) throw new Error("Code de room invalide.");
      if (name.length < 2) throw new Error("Choisis un pseudo d'au moins 2 caractères.");
      return NextResponse.json(await withRoomLock(code, (room) => {
        updatePresenceAndTimers(room);
        if (room.players.some((p) => p.name.toLocaleLowerCase("fr-FR") === name.toLocaleLowerCase("fr-FR"))) {
          throw new Error("Ce pseudo est déjà pris dans la room.");
        }
        const spectator = room.status !== "lobby";
        const player = newPlayer(name, room.nextJoinOrder++, spectator);
        room.players.push(player);
        if (room.status === "lobby") resetReady(room);
        addEvent(room, spectator ? `${name} rejoint en spectateur.` : `${name} a rejoint la room.`, "join");
        return { ok: true, session: { code, playerId: player.id, token: player.token, name }, state: publicState(room, player) };
      }));
    }

    const { code, playerId, token } = requireSession(body);
    return NextResponse.json(await withRoomLock(code, (room) => {
      const player = findPlayer(room, playerId, token);

      if (action === "leaveSignal") {
        player.leaveSignaledAt = Date.now();
        return { ok: true };
      }

      updatePresenceAndTimers(room, player.id);

      if (action === "state") {
        return { ok: true, state: publicState(room, player) };
      }

      if (action === "ready") {
        if (room.status !== "lobby" || player.isSpectator) throw new Error("Impossible de changer ton statut maintenant.");
        player.ready = Boolean(body.ready);
      } else if (action === "settings") {
        if (room.status !== "lobby") throw new Error("Les réglages ne changent qu'au lobby.");
        if (room.hostId !== player.id) throw new Error("Seul l'hôte peut changer les réglages.");
        applySettings(room, body.settings ?? {});
        resetReady(room);
        addEvent(room, "Les réglages ont changé : tout le monde repasse en Pas prêt.", "info");
      } else if (action === "start") {
        if (room.hostId !== player.id) throw new Error("Seul l'hôte peut lancer la partie.");
        startGame(room);
      } else if (action === "ackReveal") {
        ackReveal(room, player);
      } else if (action === "clue") {
        submitClue(room, player, String(body.clue ?? ""));
      } else if (action === "vote") {
        submitVote(room, player, String(body.targetId ?? ""));
      } else if (action === "mrwhiteGuess") {
        submitMrWhiteGuess(room, player, String(body.guess ?? ""));
      } else if (action === "reset") {
        if (room.hostId !== player.id) throw new Error("Seul l'hôte peut relancer une partie.");
        if (room.status !== "gameover") throw new Error("La partie n'est pas terminée.");
        resetToLobby(room);
      } else {
        throw new Error("Action inconnue.");
      }

      updatePresenceAndTimers(room, player.id);
      return { ok: true, state: publicState(room, player) };
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
