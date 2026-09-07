import { NextRequest, NextResponse } from "next/server";
import { addRoomChatMessage, clearRoomChat, getRoomChat } from "@/lib/chat-store";
import { getRoom } from "@/lib/store";
import { makeId, sanitizeCode } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(req: NextRequest) {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const action = String(body.action ?? "state");
    const code = sanitizeCode(body.code);
    const playerId = String(body.playerId ?? "");
    const token = String(body.token ?? "");

    if (!code || !playerId || !token) throw new Error("Session invalide.");

    const room = await getRoom(code);
    if (!room) throw new Error("Room introuvable ou expirée.");

    const player = room.players.find((p) => p.id === playerId && p.token === token);
    if (!player) throw new Error("Session expirée ou invalide.");

    // Le chat appartient à une partie, pas au lobby. Cela permet aussi de
    // repartir avec un chat vide à chaque nouvelle partie.
    if (room.status === "lobby") {
      await clearRoomChat(code);
      return NextResponse.json({ ok: true, status: room.status, messages: [] });
    }

    if (action === "send") {
      const message = String(body.message ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
      if (!message) throw new Error("Écris un message.");

      await addRoomChatMessage({
        id: makeId(),
        roomCode: code,
        playerId: player.id,
        playerName: player.name,
        text: message,
      });
    } else if (action !== "state") {
      throw new Error("Action inconnue.");
    }

    const messages = await getRoomChat(code);
    return NextResponse.json({ ok: true, status: room.status, messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
