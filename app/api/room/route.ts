import { NextRequest, NextResponse } from "next/server";
import type { Player, Room, RoomAccess, Settings } from "@/lib/types";
import { addEvent, ackReveal, DEFAULT_SETTINGS, publicState, resetToLobby, startGame, submitClue, submitMrWhiteGuess, submitVote, updatePresenceAndTimers } from "@/lib/game";
import { createRoomIfFree, listPublicRooms, withRoomLock } from "@/lib/store";
import { clampInt, makeId, sanitizeCode, sanitizeName } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_REQUEST_TTL_MS = 10 * 60 * 1000;

function makeCode() {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}
function newPlayer(name: string, joinOrder: number, spectator: boolean): Player {
  return {
    id: makeId(), token: `${makeId()}${makeId()}`, name, joinOrder, ready: false, connected: true,
    lastSeen: Date.now(), leaveSignaledAt: null, joinedMidGame: spectator, isSpectator: spectator,
    isEliminated: false, role: null, word: null, revealAck: false,
  };
}
async function readBody(req: NextRequest) {
  const text = await req.text(); if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}
function requireSession(body: any) {
  const code = sanitizeCode(body.code), playerId = String(body.playerId ?? ""), token = String(body.token ?? "");
  if (!code || !playerId || !token) throw new Error("Session invalide.");
  return { code, playerId, token };
}
function findPlayer(room: Room, playerId: string, token: string) {
  const player = room.players.find((p) => p.id === playerId && p.token === token);
  if (!player) throw new Error("Session expirée ou invalide.");
  return player;
}
function resetReady(room: Room) { for (const p of room.players) p.ready = false; }
function normalizeAccess(value: unknown): RoomAccess {
  return value === "public" || value === "private" || value === "code" ? value : "code";
}
function pruneJoinRequests(room: Room) {
  const cutoff = Date.now() - JOIN_REQUEST_TTL_MS;
  room.joinRequests = (room.joinRequests ?? []).filter((request) => request.createdAt >= cutoff || request.status === "accepted");
}
function safeTimer(value: unknown, current: number) {
  const parsed = Number(value);
  if (parsed === 0) return 0;
  return clampInt(Number.isFinite(parsed) ? parsed : current, 10, 120, current || 30);
}
function applySettings(room: Room, raw: Partial<Settings>) {
  const s = room.settings;
  s.clueTimeSec = safeTimer(raw.clueTimeSec, Number.isFinite(s.clueTimeSec) ? s.clueTimeSec : s.actionTimeSec ?? 30);
  s.voteTimeSec = safeTimer(raw.voteTimeSec, Number.isFinite(s.voteTimeSec) ? s.voteTimeSec : s.actionTimeSec ?? 30);
  s.actionTimeSec = s.clueTimeSec || s.voteTimeSec || 30;
  s.roundsBeforeVote = clampInt(raw.roundsBeforeVote ?? s.roundsBeforeVote, 1, 4, 2);
  if (typeof raw.keepCluesAfterVote === "boolean") s.keepCluesAfterVote = raw.keepCluesAfterVote;
  if (typeof raw.infiltratorsKnowEachOther === "boolean") s.infiltratorsKnowEachOther = raw.infiltratorsKnowEachOther;
  if (typeof raw.impostorKnowsRole === "boolean") s.impostorKnowsRole = raw.impostorKnowsRole;
  if (typeof raw.customWordA === "string") s.customWordA = raw.customWordA.trim().slice(0, 40);
  if (typeof raw.customWordB === "string") s.customWordB = raw.customWordB.trim().slice(0, 40);

  if (raw.wordSource === "custom") {
    s.wordSource = "custom";
    s.mode = "impostor";
  } else if (raw.wordSource === "random") {
    s.wordSource = "random";
  }

  if (raw.mode === "mrwhite") {
    if (s.wordSource === "custom") throw new Error("Mr White n'est pas disponible avec des mots personnalisés.");
    s.mode = "mrwhite";
  } else if (raw.mode === "impostor") {
    s.mode = "impostor";
  }

  if (s.mode === "impostor" && s.wordSource === "custom") {
    s.impostorKnowsRole = false;
    s.infiltratorsKnowEachOther = false;
  }
  if (s.mode === "impostor" && !s.impostorKnowsRole) s.infiltratorsKnowEachOther = false;
}

function addDirectPlayer(room: Room, name: string) {
  if (room.players.some((p) => p.name.toLocaleLowerCase("fr-FR") === name.toLocaleLowerCase("fr-FR"))) throw new Error("Ce pseudo est déjà pris dans la room.");
  const spectator = room.status !== "lobby";
  const player = newPlayer(name, room.nextJoinOrder++, spectator);
  room.players.push(player);
  if (room.status === "lobby") resetReady(room);
  addEvent(room, spectator ? `${name} rejoint en spectateur.` : `${name} a rejoint la room.`, "join");
  return player;
}

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const action = String(body.action ?? "");

    if (action === "publicRooms") {
      return NextResponse.json({ ok: true, rooms: await listPublicRooms() });
    }

    if (action === "create") {
      const name = sanitizeName(body.name);
      if (name.length < 2) throw new Error("Choisis un pseudo d'au moins 2 caractères.");
      const access = normalizeAccess(body.access);
      const player = newPlayer(name, 1, false);
      let room: Room | null = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        const code = makeCode();
        const candidate: Room = {
          code, createdAt: Date.now(), updatedAt: Date.now(), status: "lobby", hostId: player.id,
          nextJoinOrder: 2, access, joinRequests: [], settings: { ...DEFAULT_SETTINGS }, players: [player], game: null, events: [],
        };
        addEvent(candidate, `${name} a créé la room.`, "join");
        if (await createRoomIfFree(candidate)) { room = candidate; break; }
      }
      if (!room) throw new Error("Impossible de créer une room. Réessaie.");
      return NextResponse.json({ ok: true, session: { code: room.code, playerId: player.id, token: player.token, name }, state: publicState(room, player) });
    }

    if (action === "join") {
      const code = sanitizeCode(body.code), name = sanitizeName(body.name);
      if (code.length !== 5) throw new Error("Code de room invalide.");
      if (name.length < 2) throw new Error("Choisis un pseudo d'au moins 2 caractères.");
      return NextResponse.json(await withRoomLock(code, (room) => {
        updatePresenceAndTimers(room);
        room.access ??= "code"; room.joinRequests ??= []; pruneJoinRequests(room);
        if (room.access !== "private") {
          const player = addDirectPlayer(room, name);
          return { ok: true, session: { code, playerId: player.id, token: player.token, name }, state: publicState(room, player) };
        }
        if (room.players.some((p) => p.name.toLocaleLowerCase("fr-FR") === name.toLocaleLowerCase("fr-FR"))) throw new Error("Ce pseudo est déjà pris dans la room.");
        const existing = room.joinRequests.find((request) => request.status === "pending" && request.name.toLocaleLowerCase("fr-FR") === name.toLocaleLowerCase("fr-FR"));
        if (existing) return { ok: true, pending: { code, requestId: existing.id, requestToken: existing.requestToken, name, status: "pending" } };
        const request = { id: makeId(), requestToken: `${makeId()}${makeId()}`, name, createdAt: Date.now(), status: "pending" as const };
        room.joinRequests.push(request);
        addEvent(room, `${name} demande à rejoindre la room privée.`, "join");
        return { ok: true, pending: { code, requestId: request.id, requestToken: request.requestToken, name, status: "pending" } };
      }));
    }

    if (action === "joinStatus") {
      const code = sanitizeCode(body.code), requestId = String(body.requestId ?? ""), requestToken = String(body.requestToken ?? "");
      if (!code || !requestId || !requestToken) throw new Error("Demande d'accès invalide.");
      return NextResponse.json(await withRoomLock(code, (room) => {
        room.joinRequests ??= []; pruneJoinRequests(room);
        const request = room.joinRequests.find((item) => item.id === requestId && item.requestToken === requestToken);
        if (!request) throw new Error("Demande expirée ou introuvable.");
        if (request.status === "rejected") return { ok: true, pending: { status: "rejected", code, name: request.name } };
        if (request.status === "pending") return { ok: true, pending: { status: "pending", code, name: request.name } };
        const player = room.players.find((candidate) => candidate.id === request.playerId && candidate.token === request.playerToken);
        if (!player) throw new Error("L'accès a expiré. Refais une demande.");
        updatePresenceAndTimers(room, player.id);
        return { ok: true, session: { code, playerId: player.id, token: player.token, name: player.name }, state: publicState(room, player) };
      }));
    }

    const { code, playerId, token } = requireSession(body);
    return NextResponse.json(await withRoomLock(code, (room) => {
      const player = findPlayer(room, playerId, token);
      room.access ??= "code"; room.joinRequests ??= []; pruneJoinRequests(room);

      if (action === "leaveSignal") {
        player.leaveSignaledAt = Date.now();
        return { ok: true };
      }

      updatePresenceAndTimers(room, player.id);

      if (action === "state") return { ok: true, state: publicState(room, player) };

      if (action === "ready") {
        if (room.status !== "lobby" || player.isSpectator) throw new Error("Impossible de changer ton statut maintenant.");
        player.ready = Boolean(body.ready);
      } else if (action === "settings") {
        if (room.status !== "lobby") throw new Error("Les réglages ne changent qu'au lobby.");
        if (room.hostId !== player.id) throw new Error("Seul l'hôte peut changer les réglages.");
        applySettings(room, body.settings ?? {});
        resetReady(room);
        addEvent(room, "Les réglages ont changé : tout le monde repasse en Pas prêt.", "info");
      } else if (action === "acceptJoinRequest") {
        if (room.hostId !== player.id) throw new Error("Seul l'hôte peut accepter les demandes.");
        const request = room.joinRequests.find((item) => item.id === String(body.requestId ?? ""));
        if (!request || request.status !== "pending") throw new Error("Demande introuvable ou déjà traitée.");
        const joined = addDirectPlayer(room, request.name);
        request.status = "accepted"; request.playerId = joined.id; request.playerToken = joined.token;
        addEvent(room, `${request.name} a été accepté dans la room.`, "join");
      } else if (action === "rejectJoinRequest") {
        if (room.hostId !== player.id) throw new Error("Seul l'hôte peut refuser les demandes.");
        const request = room.joinRequests.find((item) => item.id === String(body.requestId ?? ""));
        if (!request || request.status !== "pending") throw new Error("Demande introuvable ou déjà traitée.");
        request.status = "rejected";
        addEvent(room, `La demande de ${request.name} a été refusée.`, "info");
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
