"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Session = {
  code: string;
  playerId: string;
  token: string;
  name: string;
};

type ChatMessage = {
  id: string;
  roomCode: string;
  playerId: string;
  playerName: string;
  text: string;
  at: number;
};

type RoomStatus = "lobby" | "playing" | "gameover";

const SESSION_KEY = "undercover-session-v1";

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Session>;
    if (!value.code || !value.playerId || !value.token || !value.name) return null;
    return value as Session;
  } catch {
    return null;
  }
}

async function chatRequest(session: Session, action: "state" | "send", message?: string) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...session, message }),
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "Chat indisponible.");
  return data as { ok: true; status: RoomStatus; messages: ChatMessage[] };
}

export default function ChatOverlay() {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<RoomStatus>("lobby");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(false);
  const lastMessageIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
    if (open) setUnread(0);
  }, [open]);

  useEffect(() => {
    const sync = () => {
      const next = loadSession();
      setSession((current) => {
        if (!next && !current) return current;
        if (!next) return null;
        if (current && current.code === next.code && current.playerId === next.playerId && current.token === next.token) return current;
        return next;
      });
    };
    sync();
    const id = window.setInterval(sync, 800);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setMessages([]);
    setOpen(false);
    setUnread(0);
    setError("");
    lastMessageIdRef.current = null;
    initializedRef.current = false;

    if (!session) {
      setStatus("lobby");
      return;
    }

    let alive = true;
    let inFlight = false;

    const poll = async () => {
      if (!alive || inFlight) return;
      inFlight = true;
      try {
        const data = await chatRequest(session, "state");
        if (!alive) return;
        setStatus(data.status);
        setMessages(data.messages);
        setError("");

        const last = data.messages.at(-1)?.id ?? null;
        if (!initializedRef.current) {
          initializedRef.current = true;
        } else if (last && last !== lastMessageIdRef.current && !openRef.current) {
          const previousIndex = lastMessageIdRef.current
            ? data.messages.findIndex((m) => m.id === lastMessageIdRef.current)
            : -1;
          const added = previousIndex >= 0 ? data.messages.length - previousIndex - 1 : 1;
          setUnread((n) => Math.min(99, n + Math.max(1, added)));
        }
        lastMessageIdRef.current = last;

        if (data.status === "lobby") {
          setOpen(false);
          setUnread(0);
        }
      } catch (e) {
        if (!alive) return;
        const message = e instanceof Error ? e.message : "Chat indisponible.";
        if (/introuvable|expirée|invalide/i.test(message)) {
          setStatus("lobby");
          setMessages([]);
          setOpen(false);
        } else {
          setError(message);
        }
      } finally {
        inFlight = false;
      }
    };

    poll();
    const id = window.setInterval(poll, 1100);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [session]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || status === "lobby" || !draft.trim() || busy) return;
    const text = draft.trim();
    try {
      setBusy(true);
      setError("");
      const data = await chatRequest(session, "send", text);
      setMessages(data.messages);
      setDraft("");
      setUnread(0);
      lastMessageIdRef.current = data.messages.at(-1)?.id ?? null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d'envoyer le message.");
    } finally {
      setBusy(false);
    }
  };

  if (!session || status === "lobby") return null;

  return (
    <div className="gameChatRoot">
      {open && (
        <section className="gameChatPanel" aria-label="Chat de la partie">
          <div className="gameChatHeader">
            <div>
              <strong>Chat de la partie</strong>
              <small>Tout le monde peut écrire</small>
            </div>
            <button type="button" className="gameChatClose" onClick={() => setOpen(false)} aria-label="Fermer le chat">×</button>
          </div>

          <div className="gameChatMessages" ref={listRef} aria-live="polite">
            {messages.length === 0 ? (
              <div className="gameChatEmpty">Aucun message pour l'instant.</div>
            ) : (
              messages.map((message) => {
                const own = message.playerId === session.playerId;
                return (
                  <div className={`gameChatMessage ${own ? "own" : ""}`} key={message.id}>
                    <div className="gameChatMeta">
                      <strong>{own ? "Toi" : message.playerName}</strong>
                      <span>{new Date(message.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <p>{message.text}</p>
                  </div>
                );
              })
            )}
          </div>

          <form className="gameChatForm" onSubmit={send}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={200}
              placeholder="Écris un message…"
              aria-label="Message"
            />
            <button type="submit" disabled={busy || !draft.trim()}>Envoyer</button>
          </form>
          {error && <div className="gameChatError">{error}</div>}
        </section>
      )}

      <button
        type="button"
        className={`gameChatLauncher ${open ? "opened" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Fermer le chat" : "Ouvrir le chat"}
      >
        <span className="gameChatBubbleIcon">💬</span>
        <span>Chat</span>
        {unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}
      </button>
    </div>
  );
}
