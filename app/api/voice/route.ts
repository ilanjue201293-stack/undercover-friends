import { NextRequest, NextResponse } from "next/server";
import { getRoom } from "@/lib/store";
import { addVoiceSignal, getVoiceCursor, getVoiceSignals, leaveVoice, listVoiceParticipants, touchVoiceParticipant } from "@/lib/voice-store";
import { sanitizeCode } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function bodyOf(req: NextRequest) {
  try { return JSON.parse(await req.text()); } catch { return {}; }
}

export async function POST(req: NextRequest) {
  try {
    const body = await bodyOf(req);
    const action = String(body.action || "state");
    const code = sanitizeCode(body.code);
    const playerId = String(body.playerId || "");
    const sessionKey = String(body.token || "");
    if (!code || !playerId || !sessionKey) throw new Error("Session invalide.");

    const room = await getRoom(code);
    if (!room) throw new Error("Room introuvable ou expirée.");
    const player = room.players.find((p) => p.id === playerId && p.token === sessionKey);
    if (!player) throw new Error("Session expirée ou invalide.");

    if (action === "leave") {
      await leaveVoice(code, player.id);
      return NextResponse.json({ ok: true });
    }

    // Le vocal appartient à la ROOM, pas à une manche : lobby, partie et fin de partie
    // utilisent exactement la même présence et les mêmes connexions WebRTC.
    if (action === "state") {
      return NextResponse.json({ ok: true, status: room.status, participants: await listVoiceParticipants(code), signals: [], cursor: 0 });
    }

    if (action === "join") {
      await touchVoiceParticipant(code, player.id, player.name, Boolean(body.muted));
      const participants = await listVoiceParticipants(code);
      const cursor = await getVoiceCursor(code, player.id);
      return NextResponse.json({ ok: true, status: room.status, participants, signals: [], cursor });
    }

    if (action === "poll") {
      const after = Math.max(0, Number(body.after) || 0);
      await touchVoiceParticipant(code, player.id, player.name, Boolean(body.muted));
      const participants = await listVoiceParticipants(code);
      const signals = await getVoiceSignals(code, player.id, after);
      const cursor = signals.length ? signals[signals.length - 1].id : after;
      return NextResponse.json({ ok: true, status: room.status, participants, signals, cursor });
    }

    if (action === "signal") {
      const targetId = String(body.targetId || "");
      const kind = String(body.kind || "");
      if (!targetId || targetId === player.id) throw new Error("Destinataire invalide.");
      if (!["offer", "answer", "ice"].includes(kind)) throw new Error("Signal invalide.");
      if (!room.players.some((p) => p.id === targetId)) throw new Error("Joueur introuvable.");
      await addVoiceSignal({ roomCode: code, senderId: player.id, targetId, kind: kind as "offer" | "answer" | "ice", payload: body.payload ?? null });
      return NextResponse.json({ ok: true });
    }

    throw new Error("Action inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
