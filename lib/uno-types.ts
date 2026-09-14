export type UnoColor = "red" | "yellow" | "green" | "blue" | null;
export type UnoCardValue = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "skip" | "reverse" | "draw2" | "wild" | "wild4";
export type UnoCard = { id: string; color: UnoColor; value: UnoCardValue };

export type UnoPlayer = {
  id: string;
  token: string;
  name: string;
  joinOrder: number;
  ready: boolean;
  connected: boolean;
  lastSeen: number;
  hand: UnoCard[];
};

export type UnoMessage = { id: string; playerId: string; playerName: string; text: string; at: number };

export type UnoGame = {
  phase: "playing" | "gameover";
  deck: UnoCard[];
  discard: UnoCard[];
  currentPlayerId: string;
  direction: 1 | -1;
  chosenColor: Exclude<UnoColor, null> | null;
  pendingWild4: boolean;
  unoCalledBy: string | null;
  winnerId: string | null;
  startedAt: number;
};

export type UnoRoom = {
  code: string;
  createdAt: number;
  updatedAt: number;
  status: "lobby" | "playing" | "gameover";
  hostId: string;
  nextJoinOrder: number;
  access: "public" | "code" | "private";
  joinRequests: Array<{ id: string; requestToken: string; name: string; createdAt: number; status: "pending" | "accepted" | "rejected"; playerId?: string; playerToken?: string }>;
  players: UnoPlayer[];
  game: UnoGame | null;
  messages: UnoMessage[];
};
