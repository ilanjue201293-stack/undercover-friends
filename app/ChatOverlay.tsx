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

type VoiceParticipant = {
  playerId: string;
  playerName: string;
  muted: boolean;
  lastSeen: number;
};

type VoiceSignal = {
  id: number;
  senderId: string;
  targetId: string;
  kind: "offer" | "answer" | "ice";
  payload: unknown;
};

type RoomStatus = "lobby" | "playing" | "gameover";
type Panel = "chat" | "voice" | null;
type PeerEntry = { pc: RTCPeerConnection; iceQueue: RTCIceCandidateInit[] };

const SESSION_KEY = "undercover-session-v1";
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

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

async function voiceRequest(session: Session, action: "state" | "join" | "poll" | "signal" | "leave", extra: Record<string, unknown> = {}) {
  const res = await fetch("/api/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...session, ...extra }),
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "Vocal indisponible.");
  return data as {
    ok: true;
    status?: RoomStatus;
    participants?: VoiceParticipant[];
    signals?: VoiceSignal[];
    cursor?: number;
  };
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);
    return () => { audio.srcObject = null; };
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}

export default function ChatOverlay() {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<RoomStatus>("lobby");
  const [panel, setPanel] = useState<Panel>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(0);
  const [notice, setNotice] = useState<ChatMessage | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<Panel>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const [voiceJoined, setVoiceJoined] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const voiceCursorRef = useRef(0);
  const voiceJoinedRef = useRef(false);
  const voiceMutedRef = useRef(false);

  useEffect(() => {
    panelRef.current = panel;
    if (panel === "chat") setUnread(0);
  }, [panel]);

  useEffect(() => {
    voiceJoinedRef.current = voiceJoined;
  }, [voiceJoined]);

  useEffect(() => {
    voiceMutedRef.current = voiceMuted;
  }, [voiceMuted]);

  useEffect(() => {
    const warmAudio = () => {
      if (!audioContextRef.current) {
        const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) audioContextRef.current = new Ctor();
      }
      if (audioContextRef.current?.state === "suspended") void audioContextRef.current.resume().catch(() => undefined);
    };
    window.addEventListener("pointerdown", warmAudio, { once: true });
    return () => window.removeEventListener("pointerdown", warmAudio);
  }, []);

  const playMessagePing = () => {
    try {
      let ctx = audioContextRef.current;
      if (!ctx) {
        const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        ctx = new Ctor();
        audioContextRef.current = ctx;
      }
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(720, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(920, ctx.currentTime + 0.11);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.17);
    } catch {
      // Le son est un bonus : certains navigateurs le bloquent tant que la page n'a pas été touchée.
    }
  };

  const notifyForMessages = (incoming: ChatMessage[], currentSession: Session) => {
    const others = incoming.filter((m) => m.playerId !== currentSession.playerId);
    if (others.length === 0) return;
    const latest = others[others.length - 1];

    if (panelRef.current !== "chat") {
      setUnread((n) => Math.min(99, n + others.length));
      setNotice(latest);
      playMessagePing();
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4200);
    }

    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(`${latest.playerName} · Undercover`, {
          body: latest.text,
          tag: `undercover-chat-${currentSession.code}`,
        });
      } catch {
        // Les notifications système ne sont pas disponibles sur tous les navigateurs mobiles.
      }
    }
  };

  const askNotificationPermission = () => {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => undefined);
    }
  };

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
    setPanel(null);
    setUnread(0);
    setNotice(null);
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
        } else if (last && last !== lastMessageIdRef.current) {
          const previousIndex = lastMessageIdRef.current
            ? data.messages.findIndex((m) => m.id === lastMessageIdRef.current)
            : -1;
          const added = previousIndex >= 0 ? data.messages.slice(previousIndex + 1) : [data.messages[data.messages.length - 1]];
          notifyForMessages(added, session);
        }
        lastMessageIdRef.current = last;

        if (data.status === "lobby") {
          setPanel(null);
          setUnread(0);
          setNotice(null);
        }
      } catch (e) {
        if (!alive) return;
        const message = e instanceof Error ? e.message : "Chat indisponible.";
        if (/introuvable|expirée|invalide/i.test(message)) {
          setStatus("lobby");
          setMessages([]);
          setPanel(null);
        } else {
          setError(message);
        }
      } finally {
        inFlight = false;
      }
    };

    poll();
    const id = window.setInterval(poll, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [session]);

  useEffect(() => {
    if (panel !== "chat" || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [panel, messages.length]);

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

  const closePeer = (playerId: string) => {
    const entry = peersRef.current.get(playerId);
    if (entry) {
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
      peersRef.current.delete(playerId);
    }
    setRemoteStreams((current) => {
      if (!current[playerId]) return current;
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  };

  const stopVoiceLocally = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    for (const id of [...peersRef.current.keys()]) closePeer(id);
    peersRef.current.clear();
    setRemoteStreams({});
    setVoiceJoined(false);
    voiceJoinedRef.current = false;
    setVoiceMuted(false);
    voiceMutedRef.current = false;
    voiceCursorRef.current = 0;
  };

  const sendVoiceSignal = async (targetId: string, kind: VoiceSignal["kind"], payload: unknown) => {
    if (!session || !voiceJoinedRef.current) return;
    await voiceRequest(session, "signal", { targetId, kind, payload });
  };

  const flushIce = async (entry: PeerEntry) => {
    if (!entry.pc.remoteDescription) return;
    const queued = entry.iceQueue.splice(0);
    for (const candidate of queued) {
      try { await entry.pc.addIceCandidate(candidate); } catch { /* ignore stale ICE */ }
    }
  };

  const ensurePeer = async (otherId: string, initiator: boolean): Promise<PeerEntry | null> => {
    if (!session || !voiceJoinedRef.current || !localStreamRef.current || otherId === session.playerId) return null;
    const existing = peersRef.current.get(otherId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry: PeerEntry = { pc, iceQueue: [] };
    peersRef.current.set(otherId, entry);

    for (const track of localStreamRef.current.getAudioTracks()) pc.addTrack(track, localStreamRef.current);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void sendVoiceSignal(otherId, "ice", event.candidate.toJSON()).catch(() => undefined);
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteStreams((current) => ({ ...current, [otherId]: stream }));
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") closePeer(otherId);
    };

    if (initiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendVoiceSignal(otherId, "offer", offer);
      } catch {
        closePeer(otherId);
        return null;
      }
    }

    return entry;
  };

  const handleVoiceSignal = async (signal: VoiceSignal) => {
    if (!session || signal.senderId === session.playerId) return;

    if (signal.kind === "offer") {
      const entry = await ensurePeer(signal.senderId, false);
      if (!entry) return;
      try {
        if (entry.pc.signalingState !== "stable" && entry.pc.signalingState === "have-local-offer") {
          await entry.pc.setLocalDescription({ type: "rollback" });
        }
        await entry.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
        await flushIce(entry);
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        await sendVoiceSignal(signal.senderId, "answer", answer);
      } catch {
        closePeer(signal.senderId);
      }
      return;
    }

    const entry = peersRef.current.get(signal.senderId) ?? await ensurePeer(signal.senderId, false);
    if (!entry) return;

    if (signal.kind === "answer") {
      try {
        if (entry.pc.signalingState === "have-local-offer") {
          await entry.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
          await flushIce(entry);
        }
      } catch {
        closePeer(signal.senderId);
      }
      return;
    }

    if (signal.kind === "ice") {
      const candidate = signal.payload as RTCIceCandidateInit;
      if (entry.pc.remoteDescription) {
        try { await entry.pc.addIceCandidate(candidate); } catch { /* stale candidate */ }
      } else {
        entry.iceQueue.push(candidate);
      }
    }
  };

  const syncVoicePeers = async (participants: VoiceParticipant[]) => {
    if (!session || !voiceJoinedRef.current) return;
    const active = new Set(participants.filter((p) => p.playerId !== session.playerId).map((p) => p.playerId));
    for (const id of [...peersRef.current.keys()]) {
      if (!active.has(id)) closePeer(id);
    }
    for (const participant of participants) {
      if (participant.playerId === session.playerId || peersRef.current.has(participant.playerId)) continue;
      if (session.playerId.localeCompare(participant.playerId) < 0) {
        await ensurePeer(participant.playerId, true);
      }
    }
  };

  const joinVoice = async () => {
    if (!session || status === "lobby" || voiceBusy || voiceJoinedRef.current) {
      setPanel("voice");
      return;
    }
    try {
      setVoiceBusy(true);
      setVoiceError("");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Ton navigateur ne permet pas l'accès au micro.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      localStreamRef.current = stream;
      const data = await voiceRequest(session, "join", { muted: false });
      voiceCursorRef.current = Number(data.cursor ?? 0);
      setVoiceParticipants(data.participants ?? []);
      setVoiceMuted(false);
      voiceMutedRef.current = false;
      setVoiceJoined(true);
      voiceJoinedRef.current = true;
      setPanel("voice");
    } catch (e) {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setVoiceError(e instanceof Error ? e.message : "Impossible de rejoindre le vocal.");
      setPanel("voice");
    } finally {
      setVoiceBusy(false);
    }
  };

  const leaveVoiceCall = async () => {
    const activeSession = session;
    try {
      setVoiceBusy(true);
      if (activeSession && voiceJoinedRef.current) await voiceRequest(activeSession, "leave");
    } catch {
      // On quitte localement même si le serveur ne répond plus.
    } finally {
      stopVoiceLocally();
      setVoiceParticipants((current) => current.filter((p) => p.playerId !== activeSession?.playerId));
      setVoiceBusy(false);
    }
  };

  const toggleMute = () => {
    if (!voiceJoinedRef.current) return;
    const next = !voiceMutedRef.current;
    voiceMutedRef.current = next;
    setVoiceMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
  };

  useEffect(() => {
    if (!session || status === "lobby" || voiceJoined) return;
    let alive = true;
    let inFlight = false;
    const peek = async () => {
      if (!alive || inFlight) return;
      inFlight = true;
      try {
        const data = await voiceRequest(session, "state");
        if (alive) setVoiceParticipants(data.participants ?? []);
      } catch {
        if (alive) setVoiceParticipants([]);
      } finally {
        inFlight = false;
      }
    };
    void peek();
    const id = window.setInterval(peek, 1800);
    return () => { alive = false; window.clearInterval(id); };
  }, [session, status, voiceJoined]);

  useEffect(() => {
    if (!session || status === "lobby" || !voiceJoined) return;
    let alive = true;
    let inFlight = false;

    const pollVoice = async () => {
      if (!alive || inFlight || !voiceJoinedRef.current) return;
      inFlight = true;
      try {
        const data = await voiceRequest(session, "poll", {
          after: voiceCursorRef.current,
          muted: voiceMutedRef.current,
        });
        if (!alive) return;
        const participants = data.participants ?? [];
        const signals = data.signals ?? [];
        voiceCursorRef.current = Number(data.cursor ?? voiceCursorRef.current);
        setVoiceParticipants(participants);
        setVoiceError("");
        for (const signal of signals) await handleVoiceSignal(signal);
        await syncVoicePeers(participants);
      } catch (e) {
        if (alive) setVoiceError(e instanceof Error ? e.message : "Connexion vocale instable.");
      } finally {
        inFlight = false;
      }
    };

    void pollVoice();
    const id = window.setInterval(pollVoice, 800);
    return () => { alive = false; window.clearInterval(id); };
  }, [session, status, voiceJoined]);

  useEffect(() => {
    if (status !== "lobby" || !voiceJoinedRef.current) return;
    void leaveVoiceCall();
  }, [status]);

  useEffect(() => {
    if (!session) return;
    const currentSession = session;
    const pageHide = () => {
      if (!voiceJoinedRef.current) return;
      try {
        const blob = new Blob([JSON.stringify({ action: "leave", ...currentSession })], { type: "application/json" });
        navigator.sendBeacon("/api/voice", blob);
      } catch { /* best effort */ }
    };
    window.addEventListener("pagehide", pageHide);
    return () => {
      window.removeEventListener("pagehide", pageHide);
      pageHide();
      stopVoiceLocally();
    };
  }, [session?.code, session?.playerId]);

  if (!session || status === "lobby") return null;

  const voiceCount = voiceParticipants.length;

  return (
    <div className="gameChatRoot">
      {notice && panel !== "chat" && (
        <button className="gameMessageToast" type="button" onClick={() => { setPanel("chat"); setNotice(null); setUnread(0); askNotificationPermission(); }}>
          <span className="gameMessageToastIcon">💬</span>
          <span><strong>{notice.playerName}</strong><small>{notice.text}</small></span>
        </button>
      )}

      {panel === "chat" && (
        <section className="gameChatPanel" aria-label="Chat de la partie">
          <div className="gameChatHeader">
            <div>
              <strong>Chat de la partie</strong>
              <small>Tout le monde peut écrire</small>
            </div>
            <button type="button" className="gameChatClose" onClick={() => setPanel(null)} aria-label="Fermer le chat">×</button>
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
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} placeholder="Écris un message…" aria-label="Message" />
            <button type="submit" disabled={busy || !draft.trim()}>Envoyer</button>
          </form>
          {error && <div className="gameChatError">{error}</div>}
        </section>
      )}

      {panel === "voice" && (
        <section className="gameChatPanel voicePanel" aria-label="Appel vocal de la partie">
          <div className="gameChatHeader">
            <div>
              <strong>Appel de groupe</strong>
              <small>{voiceCount ? `${voiceCount} dans le vocal` : "Personne dans le vocal"}</small>
            </div>
            <button type="button" className="gameChatClose" onClick={() => setPanel(null)} aria-label="Fermer le vocal">×</button>
          </div>

          <div className="voiceBody">
            <div className={`voiceCallOrb ${voiceJoined ? "joined" : ""}`}><span>{voiceJoined ? "🎙" : "☎"}</span></div>
            <div className="voiceStatusText">
              <strong>{voiceJoined ? "Tu es dans l'appel" : "Rejoins tes potes"}</strong>
              <p>{voiceJoined ? "Le vocal continue même si tu fermes cette fenêtre." : "Ton navigateur te demandera l'autorisation d'utiliser ton micro."}</p>
            </div>

            <div className="voicePeople">
              {voiceParticipants.length === 0 ? <div className="voiceEmpty">Aucun participant pour l'instant.</div> : voiceParticipants.map((p) => (
                <div className="voicePerson" key={p.playerId}>
                  <span className="voiceAvatar">{p.playerName.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{p.playerId === session.playerId ? "Toi" : p.playerName}</strong><small>{p.muted ? "Micro coupé" : "Micro activé"}</small></div>
                  <span className={p.muted ? "voiceMic muted" : "voiceMic"}>{p.muted ? "🔇" : "🎙"}</span>
                </div>
              ))}
            </div>

            {!voiceJoined ? (
              <button className="voiceJoinButton" type="button" disabled={voiceBusy} onClick={joinVoice}>{voiceBusy ? "Connexion…" : "Rejoindre l'appel"}</button>
            ) : (
              <div className="voiceControls">
                <button type="button" className={voiceMuted ? "voiceControl muted" : "voiceControl"} onClick={toggleMute}>{voiceMuted ? "🔇 Réactiver" : "🎙 Couper le micro"}</button>
                <button type="button" className="voiceHangup" disabled={voiceBusy} onClick={() => void leaveVoiceCall()}>☎ Quitter</button>
              </div>
            )}
          </div>
          {voiceError && <div className="gameChatError">{voiceError}</div>}
        </section>
      )}

      <div className="communicationLaunchers">
        <button
          type="button"
          className={`voiceLauncher ${panel === "voice" ? "opened" : ""} ${voiceJoined ? "inCall" : ""}`}
          onClick={() => { if (voiceJoined) setPanel(panel === "voice" ? null : "voice"); else void joinVoice(); }}
          aria-label="Ouvrir le vocal"
        >
          <span>{voiceJoined ? (voiceMuted ? "🔇" : "🎙") : "🎙"}</span>
          <span>Vocal</span>
          {voiceCount > 0 && <b>{voiceCount}</b>}
        </button>

        <button
          type="button"
          className={`gameChatLauncher ${panel === "chat" ? "opened" : ""}`}
          onClick={() => { const next = panel === "chat" ? null : "chat"; setPanel(next); if (next === "chat") { setUnread(0); setNotice(null); askNotificationPermission(); } }}
          aria-label={panel === "chat" ? "Fermer le chat" : "Ouvrir le chat"}
        >
          <span className="gameChatBubbleIcon">💬</span>
          <span>Chat</span>
          {unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}
        </button>
      </div>

      <div className="voiceAudioSinks" aria-hidden="true">
        {Object.entries(remoteStreams).map(([playerId, stream]) => <RemoteAudio key={playerId} stream={stream} />)}
      </div>
    </div>
  );
}
