export type GameMode = "impostor" | "mrwhite";
export type Role = "civil" | "infiltrator";
export type RoomStatus = "lobby" | "playing" | "gameover";
export type RoomAccess = "public" | "code" | "private";
export type GamePhase =
  | "reveal"
  | "clue"
  | "vote"
  | "tiebreak-clue"
  | "tiebreak-vote"
  | "mrwhite-guess"
  | "gameover";

export type Settings = {
  mode: GameMode;
  roundsBeforeVote: number;
  clueTimeSec: number;
  voteTimeSec: number;
  actionTimeSec?: number;
  keepCluesAfterVote: boolean;
  infiltratorsKnowEachOther: boolean;
  impostorKnowsRole: boolean;
  wordSource: "random" | "custom";
  customWordA: string;
  customWordB: string;
};

export type Player = {
  id: string;
  token: string;
  name: string;
  joinOrder: number;
  ready: boolean;
  connected: boolean;
  lastSeen: number;
  leaveSignaledAt: number | null;
  joinedMidGame: boolean;
  isSpectator: boolean;
  isEliminated: boolean;
  role: Role | null;
  word: string | null;
  revealAck: boolean;
};

export type JoinRequest = {
  id: string;
  requestToken: string;
  name: string;
  createdAt: number;
  status: "pending" | "accepted" | "rejected";
  playerId?: string;
  playerToken?: string;
};

export type Clue = {
  id: string;
  playerId: string;
  text: string;
  cycle: number;
  round: number;
  kind: "normal" | "tiebreak";
  at: number;
};

export type VoteReveal = {
  at: number;
  votes: Array<{ voterId: string; targetId: string }>;
  tally: Record<string, number>;
  eliminatedId: string | null;
  tiedIds: string[];
};

export type RoomEvent = {
  id: string;
  at: number;
  text: string;
  kind: "info" | "join" | "leave" | "game" | "vote" | "win";
};

export type GameState = {
  phase: GamePhase;
  cycle: number;
  clueRound: number;
  order: string[];
  turnIndex: number;
  turnStartedAt: number | null;
  voteStartedAt: number | null;
  votes: Record<string, string>;
  clues: Clue[];
  visibleClueStartIndex: number;
  usedClueKeys: string[];
  tieCandidates: string[];
  tiebreakIteration: number;
  pendingMrWhiteId: string | null;
  civilianWord: string;
  infiltratorWord: string | null;
  wordTheme?: string;
  infiltratorCountInitial: number;
  lastVoteReveal: VoteReveal | null;
  winner: "civilians" | "infiltrators" | null;
  winReason: string | null;
};

export type Room = {
  code: string;
  createdAt: number;
  updatedAt: number;
  status: RoomStatus;
  hostId: string;
  nextJoinOrder: number;
  access?: RoomAccess;
  joinRequests?: JoinRequest[];
  settings: Settings;
  players: Player[];
  game: GameState | null;
  events: RoomEvent[];
};
