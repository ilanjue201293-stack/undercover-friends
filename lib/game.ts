import type { GameState, Player, Room, Settings, VoteReveal } from "./types";
import { WORD_PAIRS } from "./words";
import { infiltratorCountFor, makeId, normalizeClue, normalizeGuess, shuffle } from "./utils";

const now = () => Date.now();

export const DEFAULT_SETTINGS: Settings = {
  mode: "impostor",
  roundsBeforeVote: 2,
  clueTimeSec: 30,
  voteTimeSec: 30,
  actionTimeSec: 30,
  keepCluesAfterVote: false,
  infiltratorsKnowEachOther: false,
  impostorKnowsRole: false,
  wordSource: "random",
  customWordA: "",
  customWordB: "",
};

function clueTime(settings: Settings) {
  return Number.isFinite(settings.clueTimeSec) ? Math.max(0, settings.clueTimeSec) : Math.max(0, settings.actionTimeSec ?? 30);
}
function voteTime(settings: Settings) {
  return Number.isFinite(settings.voteTimeSec) ? Math.max(0, settings.voteTimeSec) : Math.max(0, settings.actionTimeSec ?? 30);
}

export function addEvent(room: Room, text: string, kind: Room["events"][number]["kind"] = "info") {
  room.events.push({ id: makeId(), at: now(), text, kind });
  if (room.events.length > 60) room.events.splice(0, room.events.length - 60);
}

function alivePlayers(room: Room) {
  return room.players.filter((p) => !p.isSpectator && !p.isEliminated && p.role !== null);
}
function connectedAlive(room: Room) {
  return alivePlayers(room).filter((p) => p.connected);
}
function roleLabel(room: Room) {
  return room.settings.mode === "mrwhite" ? "Mr White" : "Imposteur";
}

function chooseWords(settings: Settings) {
  if (settings.mode === "mrwhite") {
    const pair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
    return { civilianWord: pair[Math.floor(Math.random() * 2)], infiltratorWord: null, wordTheme: pair[2] };
  }
  if (settings.wordSource === "custom") {
    const a = settings.customWordA.trim();
    const b = settings.customWordB.trim();
    const flip = Math.random() < 0.5;
    return { civilianWord: flip ? a : b, infiltratorWord: flip ? b : a, wordTheme: "Mots personnalisés" };
  }
  const pair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
  const flip = Math.random() < 0.5;
  return { civilianWord: flip ? pair[0] : pair[1], infiltratorWord: flip ? pair[1] : pair[0], wordTheme: pair[2] };
}

function newOrder(room: Room) {
  return shuffle(alivePlayers(room).map((p) => p.id));
}

export function startGame(room: Room) {
  const participants = room.players.filter((p) => p.connected && !p.isSpectator);
  if (participants.length < 3) throw new Error("Il faut au moins 3 joueurs connectés.");
  if (participants.some((p) => !p.ready)) throw new Error("Tous les joueurs doivent être prêts.");
  if (room.settings.wordSource === "custom" && room.settings.mode === "mrwhite") {
    throw new Error("Mr White n'est pas disponible avec des mots personnalisés.");
  }
  if (room.settings.mode === "impostor" && room.settings.wordSource === "custom") {
    if (!room.settings.customWordA.trim() || !room.settings.customWordB.trim()) throw new Error("Entre les deux mots personnalisés.");
    room.settings.impostorKnowsRole = false;
    room.settings.infiltratorsKnowEachOther = false;
  }

  room.status = "playing";
  for (const p of room.players) {
    p.ready = false; p.role = null; p.word = null; p.revealAck = false; p.isEliminated = false;
    if (!p.connected || p.joinedMidGame) p.isSpectator = true;
  }

  const active = room.players.filter((p) => p.connected && !p.isSpectator);
  const infiltratorCount = Math.min(infiltratorCountFor(active.length), active.length - 1);
  const infiltratorIds = new Set(shuffle(active.map((p) => p.id)).slice(0, infiltratorCount));
  const words = chooseWords(room.settings);

  for (const p of active) {
    if (infiltratorIds.has(p.id)) { p.role = "infiltrator"; p.word = room.settings.mode === "mrwhite" ? null : words.infiltratorWord; }
    else { p.role = "civil"; p.word = words.civilianWord; }
  }

  room.game = {
    phase: "reveal", cycle: 1, clueRound: 1, order: [], turnIndex: 0, turnStartedAt: null, voteStartedAt: null,
    votes: {}, clues: [], visibleClueStartIndex: 0, usedClueKeys: [], tieCandidates: [], tiebreakIteration: 0,
    pendingMrWhiteId: null, civilianWord: words.civilianWord, infiltratorWord: words.infiltratorWord,
    wordTheme: words.wordTheme, infiltratorCountInitial: infiltratorCount, lastVoteReveal: null, winner: null, winReason: null,
  };
  addEvent(room, `La partie commence avec ${active.length} joueurs et ${infiltratorCount} ${roleLabel(room)}${infiltratorCount > 1 ? "s" : ""}.`, "game");
}

export function ackReveal(room: Room, player: Player) {
  if (!room.game || room.game.phase !== "reveal" || player.isSpectator || player.isEliminated) return;
  player.revealAck = true;
  maybeStartCluesAfterReveal(room);
}
function maybeStartCluesAfterReveal(room: Room) {
  if (!room.game || room.game.phase !== "reveal") return;
  const waiting = alivePlayers(room).filter((p) => p.connected && !p.revealAck);
  if (waiting.length > 0) return;
  beginClueRound(room, 1, false);
}
function beginClueRound(room: Room, round: number, preserveCycle: boolean) {
  if (!room.game) return;
  room.game.phase = "clue"; room.game.clueRound = round; room.game.order = newOrder(room); room.game.turnIndex = 0;
  room.game.turnStartedAt = now(); room.game.voteStartedAt = null; room.game.votes = {}; room.game.tieCandidates = []; room.game.pendingMrWhiteId = null;
  if (!preserveCycle && round === 1) { /* cycle already prepared */ }
  addEvent(room, `Manche ${round}/${room.settings.roundsBeforeVote} — nouvel ordre aléatoire.`, "game");
  skipUnavailableTurns(room);
}
function beginNextCycle(room: Room) {
  if (!room.game) return;
  room.game.cycle += 1; room.game.clueRound = 1; room.game.votes = {}; room.game.tieCandidates = []; room.game.tiebreakIteration = 0; room.game.pendingMrWhiteId = null;
  if (!room.settings.keepCluesAfterVote) room.game.visibleClueStartIndex = room.game.clues.length;
  beginClueRound(room, 1, false);
}
function beginVote(room: Room) {
  if (!room.game) return;
  room.game.phase = "vote"; room.game.votes = {}; room.game.voteStartedAt = now(); room.game.turnStartedAt = null; room.game.tieCandidates = [];
  addEvent(room, "Vote ouvert. Les choix restent secrets jusqu'au résultat.", "vote");
}
function currentTurnId(game: GameState) { return game.order[game.turnIndex] ?? null; }
function skipUnavailableTurns(room: Room) {
  const game = room.game;
  if (!game || (game.phase !== "clue" && game.phase !== "tiebreak-clue")) return;
  while (game.turnIndex < game.order.length) {
    const id = currentTurnId(game), player = room.players.find((p) => p.id === id);
    if (player && player.connected && !player.isEliminated && !player.isSpectator) break;
    if (player) addEvent(room, `Tour de ${player.name} passé : joueur absent.`, "leave");
    game.turnIndex += 1; game.turnStartedAt = now();
  }
  if (game.turnIndex >= game.order.length) finishClueSequence(room);
}
function finishClueSequence(room: Room) {
  const game = room.game; if (!game) return;
  if (game.phase === "tiebreak-clue") { beginTiebreakVote(room); return; }
  if (game.clueRound < room.settings.roundsBeforeVote) beginClueRound(room, game.clueRound + 1, true); else beginVote(room);
}

export function submitClue(room: Room, player: Player, raw: string) {
  const game = room.game;
  if (!game || (game.phase !== "clue" && game.phase !== "tiebreak-clue")) throw new Error("Ce n'est pas le moment de donner un indice.");
  if (currentTurnId(game) !== player.id) throw new Error("Ce n'est pas ton tour.");
  const text = String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!text) throw new Error("Écris un indice.");
  const key = normalizeClue(text);
  if (game.usedClueKeys.includes(key)) throw new Error("Cet indice a déjà été utilisé dans cette partie.");
  game.usedClueKeys.push(key);
  game.clues.push({ id: makeId(), playerId: player.id, text, cycle: game.cycle, round: game.clueRound, kind: game.phase === "tiebreak-clue" ? "tiebreak" : "normal", at: now() });
  game.turnIndex += 1; game.turnStartedAt = now();
  if (game.turnIndex >= game.order.length) finishClueSequence(room); else skipUnavailableTurns(room);
}

function eligibleVoters(room: Room) {
  const game = room.game; if (!game) return [] as Player[];
  const alive = alivePlayers(room); if (game.phase !== "tiebreak-vote") return alive;
  const neutral = alive.filter((p) => !game.tieCandidates.includes(p.id));
  return neutral.length > 0 ? neutral : alive;
}
function allowedTargets(room: Room, voter: Player) {
  const game = room.game; if (!game) return [] as Player[];
  const alive = alivePlayers(room); if (game.phase !== "tiebreak-vote") return alive;
  const targets = alive.filter((p) => game.tieCandidates.includes(p.id));
  const neutralExists = alive.some((p) => !game.tieCandidates.includes(p.id));
  return neutralExists ? targets : targets.filter((p) => p.id !== voter.id);
}
export function submitVote(room: Room, voter: Player, targetId: string) {
  const game = room.game;
  if (!game || (game.phase !== "vote" && game.phase !== "tiebreak-vote")) throw new Error("Le vote n'est pas ouvert.");
  if (voter.isSpectator || voter.isEliminated) throw new Error("Tu ne peux pas voter.");
  if (!eligibleVoters(room).some((p) => p.id === voter.id)) throw new Error("Tu ne votes pas pendant ce départage.");
  if (game.votes[voter.id]) throw new Error("Ton vote est déjà envoyé.");
  if (!allowedTargets(room, voter).some((p) => p.id === targetId)) throw new Error("Vote invalide.");
  game.votes[voter.id] = targetId; maybeResolveVotesEarly(room);
}
function connectedEligibleVoters(room: Room) { return eligibleVoters(room).filter((p) => p.connected); }
function maybeResolveVotesEarly(room: Room) {
  const game = room.game; if (!game || (game.phase !== "vote" && game.phase !== "tiebreak-vote")) return;
  const voters = connectedEligibleVoters(room); if (voters.length > 0 && voters.every((p) => Boolean(game.votes[p.id]))) resolveVotes(room);
}
function resolveVotes(room: Room) {
  const game = room.game; if (!game) return;
  const validVoterIds = new Set(eligibleVoters(room).map((p) => p.id));
  const targetIds = new Set(game.phase === "tiebreak-vote" ? game.tieCandidates : alivePlayers(room).map((p) => p.id));
  const entries = Object.entries(game.votes).filter(([voterId, targetId]) => validVoterIds.has(voterId) && targetIds.has(targetId));
  const tally: Record<string, number> = {}; for (const [, targetId] of entries) tally[targetId] = (tally[targetId] ?? 0) + 1;
  if (entries.length === 0) { game.lastVoteReveal = { at: now(), votes: [], tally: {}, eliminatedId: null, tiedIds: [] }; addEvent(room, "Aucun vote reçu : personne n'est éliminé.", "vote"); beginNextCycle(room); return; }
  const max = Math.max(...Object.values(tally)); const top = Object.keys(tally).filter((id) => tally[id] === max);
  const reveal: VoteReveal = { at: now(), votes: entries.map(([voterId, targetId]) => ({ voterId, targetId })), tally, eliminatedId: null, tiedIds: top.length > 1 ? top : [] };
  game.lastVoteReveal = reveal;
  if (top.length === 1) { reveal.eliminatedId = top[0]; eliminate(room, top[0]); return; }
  game.tieCandidates = top; game.tiebreakIteration += 1;
  const names = top.map((id) => room.players.find((p) => p.id === id)?.name ?? "?").join(", ");
  addEvent(room, `Égalité entre ${names}. Ils doivent donner un indice supplémentaire.`, "vote"); beginTiebreakClues(room);
}
function beginTiebreakClues(room: Room) {
  const game = room.game; if (!game) return;
  game.phase = "tiebreak-clue";
  game.order = shuffle(game.tieCandidates.filter((id) => { const p = room.players.find((x) => x.id === id); return p && !p.isEliminated && !p.isSpectator; }));
  game.turnIndex = 0; game.turnStartedAt = now(); game.voteStartedAt = null; game.votes = {}; skipUnavailableTurns(room);
}
function beginTiebreakVote(room: Room) {
  const game = room.game; if (!game) return;
  game.phase = "tiebreak-vote"; game.votes = {}; game.voteStartedAt = now(); game.turnStartedAt = null;
  addEvent(room, "Revote de départage ouvert.", "vote"); maybeResolveVotesEarly(room);
}
function countRoles(room: Room) {
  const alive = alivePlayers(room); return { infiltrators: alive.filter((p) => p.role === "infiltrator").length, civilians: alive.filter((p) => p.role === "civil").length };
}
function checkParityWin(room: Room) {
  const counts = countRoles(room);
  if (counts.infiltrators > 0 && counts.infiltrators >= counts.civilians) { endGame(room, "infiltrators", `${roleLabel(room)}${counts.infiltrators > 1 ? "s" : ""} aussi nombreux que les civils.`); return true; }
  return false;
}
function eliminate(room: Room, playerId: string) {
  const game = room.game; if (!game) return;
  const player = room.players.find((p) => p.id === playerId); if (!player || player.isEliminated || player.isSpectator) return;
  player.isEliminated = true; player.isSpectator = true;
  const isInfiltrator = player.role === "infiltrator", revealed = isInfiltrator ? roleLabel(room) : "Civil";
  addEvent(room, `${player.name} est éliminé : ${revealed}.`, "vote");
  if (isInfiltrator) {
    const remaining = countRoles(room).infiltrators; addEvent(room, `Il reste ${remaining} ${roleLabel(room)}${remaining > 1 ? "s" : ""} en jeu.`, "game");
    if (room.settings.mode === "mrwhite") { game.phase = "mrwhite-guess"; game.pendingMrWhiteId = player.id; game.turnStartedAt = null; game.voteStartedAt = null; addEvent(room, `${player.name} a une tentative pour deviner le mot des civils.`, "game"); return; }
    if (remaining === 0) { endGame(room, "civilians", "Tous les imposteurs ont été éliminés."); return; }
    beginNextCycle(room); return;
  }
  if (checkParityWin(room)) return; beginNextCycle(room);
}

export function submitMrWhiteGuess(room: Room, player: Player, guess: string) {
  const game = room.game;
  if (!game || game.phase !== "mrwhite-guess" || game.pendingMrWhiteId !== player.id) throw new Error("Tu n'as pas de tentative à faire.");
  const correct = normalizeGuess(guess) === normalizeGuess(game.civilianWord);
  if (correct) { addEvent(room, `${player.name} a trouvé le mot « ${game.civilianWord} » !`, "win"); endGame(room, "infiltrators", "Mr White a deviné le mot des civils après son élimination."); return; }
  addEvent(room, `${player.name} n'a pas trouvé le mot des civils.`, "game"); game.pendingMrWhiteId = null;
  const remaining = countRoles(room).infiltrators;
  if (remaining === 0) { endGame(room, "civilians", "Tous les Mr White ont été éliminés et aucun n'a trouvé le mot."); return; }
  beginNextCycle(room);
}
function endGame(room: Room, winner: "civilians" | "infiltrators", reason: string) {
  if (!room.game) return;
  room.status = "gameover"; room.game.phase = "gameover"; room.game.winner = winner; room.game.winReason = reason; room.game.turnStartedAt = null; room.game.voteStartedAt = null; room.game.pendingMrWhiteId = null;
  addEvent(room, winner === "civilians" ? `Victoire des civils — ${reason}` : `Victoire des ${roleLabel(room)}s — ${reason}`, "win");
}
export function resetToLobby(room: Room) {
  room.status = "lobby"; room.game = null;
  for (const p of room.players) { p.ready = false; p.role = null; p.word = null; p.revealAck = false; p.isEliminated = false; p.joinedMidGame = false; p.isSpectator = false; }
  addEvent(room, "Retour au lobby. Tout le monde doit se remettre prêt.", "game");
}

export function updatePresenceAndTimers(room: Room, currentPlayerId?: string) {
  const t = now();
  const current = currentPlayerId ? room.players.find((p) => p.id === currentPlayerId) : null;
  if (current) { const wasAway = !current.connected; current.connected = true; current.lastSeen = t; current.leaveSignaledAt = null; if (wasAway) addEvent(room, `${current.name} est revenu.`, "join"); }
  for (const p of room.players) {
    if (!p.connected || p.id === currentPlayerId) continue;
    const signaledGone = p.leaveSignaledAt !== null && t - p.leaveSignaledAt >= 5000;
    const heartbeatGone = t - p.lastSeen >= 12000;
    if (signaledGone || heartbeatGone) { p.connected = false; addEvent(room, `${p.name} n'est plus sur le site.`, "leave"); }
  }
  if (!room.players.find((p) => p.id === room.hostId)?.connected) {
    const next = room.players.filter((p) => p.connected).sort((a, b) => a.joinOrder - b.joinOrder)[0];
    if (next && next.id !== room.hostId) { room.hostId = next.id; addEvent(room, `${next.name} devient l'hôte de la room.`, "info"); }
  }
  const game = room.game; if (!game || room.status !== "playing") return;
  if (game.phase === "reveal") { maybeStartCluesAfterReveal(room); return; }
  if (game.phase === "clue" || game.phase === "tiebreak-clue") {
    skipUnavailableTurns(room); if (!room.game || (room.game.phase !== "clue" && room.game.phase !== "tiebreak-clue")) return;
    const limit = clueTime(room.settings); if (limit <= 0) return;
    const started = room.game.turnStartedAt ?? t;
    if (t - started >= limit * 1000) { const id = currentTurnId(room.game), p = room.players.find((x) => x.id === id); if (p) addEvent(room, `Temps écoulé pour ${p.name} : tour passé.`, "game"); room.game.turnIndex += 1; room.game.turnStartedAt = t; if (room.game.turnIndex >= room.game.order.length) finishClueSequence(room); else skipUnavailableTurns(room); }
    return;
  }
  if (game.phase === "vote" || game.phase === "tiebreak-vote") {
    maybeResolveVotesEarly(room); if (!room.game || (room.game.phase !== "vote" && room.game.phase !== "tiebreak-vote")) return;
    const limit = voteTime(room.settings); if (limit <= 0) return;
    const started = room.game.voteStartedAt ?? t; if (t - started >= limit * 1000) resolveVotes(room);
  }
}

export function publicState(room: Room, requester: Player) {
  const game = room.game;
  const selfRole = (() => {
    if (!requester.role) return null;
    if (room.status === "gameover" || requester.isEliminated) return requester.role;
    if (room.settings.mode === "mrwhite") return requester.role;
    if (requester.role === "civil") return room.settings.impostorKnowsRole ? "civil" : "unknown";
    return room.settings.impostorKnowsRole ? "infiltrator" : "unknown";
  })();
  const canKnowTeammates = requester.role === "infiltrator" && room.settings.infiltratorsKnowEachOther && (room.settings.mode === "mrwhite" || room.settings.impostorKnowsRole);
  const visibleClues = game ? game.clues.slice(room.settings.keepCluesAfterVote ? 0 : game.visibleClueStartIndex) : [];
  const currentTurn = game && (game.phase === "clue" || game.phase === "tiebreak-clue") ? currentTurnId(game) : null;
  const clueLimit = clueTime(room.settings), voteLimit = voteTime(room.settings);
  const phaseDeadline = game
    ? (game.phase === "clue" || game.phase === "tiebreak-clue") && game.turnStartedAt && clueLimit > 0
      ? game.turnStartedAt + clueLimit * 1000
      : (game.phase === "vote" || game.phase === "tiebreak-vote") && game.voteStartedAt && voteLimit > 0
        ? game.voteStartedAt + voteLimit * 1000
        : null
    : null;
  const voters = game && (game.phase === "vote" || game.phase === "tiebreak-vote") ? eligibleVoters(room) : [];
  const targets = game && (game.phase === "vote" || game.phase === "tiebreak-vote") ? allowedTargets(room, requester) : [];
  const mrWhiteThemeHint = Boolean(
    game && room.settings.mode === "mrwhite" && requester.role === "infiltrator" && game.phase === "clue" &&
    game.clueRound === 1 && game.turnIndex === 0 && currentTurn === requester.id
  ) ? game?.wordTheme ?? null : null;

  return {
    code: room.code,
    access: room.access ?? "code",
    status: room.status,
    hostId: room.hostId,
    settings: {
      ...room.settings,
      clueTimeSec: clueLimit,
      voteTimeSec: voteLimit,
      customWordA: requester.id === room.hostId && room.status === "lobby" ? room.settings.customWordA : "",
      customWordB: requester.id === room.hostId && room.status === "lobby" ? room.settings.customWordB : "",
    },
    joinRequests: requester.id === room.hostId
      ? (room.joinRequests ?? []).filter((request) => request.status === "pending").map(({ id, name, createdAt }) => ({ id, name, createdAt }))
      : [],
    players: room.players.map((p) => ({ id: p.id, name: p.name, joinOrder: p.joinOrder, ready: p.ready, connected: p.connected, joinedMidGame: p.joinedMidGame, isSpectator: p.isSpectator, isEliminated: p.isEliminated, revealedRole: p.isEliminated || room.status === "gameover" ? p.role : null })),
    me: {
      id: requester.id, name: requester.name, isHost: requester.id === room.hostId, ready: requester.ready, connected: requester.connected,
      isSpectator: requester.isSpectator, isEliminated: requester.isEliminated, role: selfRole,
      word: room.status === "playing" || room.status === "gameover" ? requester.word : null, revealAck: requester.revealAck,
      knownTeammateIds: canKnowTeammates ? room.players.filter((p) => p.id !== requester.id && p.role === "infiltrator").map((p) => p.id) : [],
    },
    game: game ? {
      phase: game.phase, cycle: game.cycle, clueRound: game.clueRound, currentTurnId: currentTurn, order: game.order,
      submittedVoterIds: Object.keys(game.votes), eligibleVoterIds: voters.map((p) => p.id), allowedTargetIds: targets.map((p) => p.id), clues: visibleClues,
      tieCandidates: game.tieCandidates, tiebreakIteration: game.tiebreakIteration, pendingMrWhiteId: game.pendingMrWhiteId,
      phaseDeadline, mrWhiteThemeHint, lastVoteReveal: game.lastVoteReveal, winner: game.winner, winReason: game.winReason,
      civilianWord: room.status === "gameover" ? game.civilianWord : null,
      infiltratorWord: room.status === "gameover" ? game.infiltratorWord : null,
      infiltratorCountInitial: game.infiltratorCountInitial,
    } : null,
    events: room.events.slice(-30),
    serverNow: now(),
  };
}
