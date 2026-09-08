"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Session = { code: string; playerId: string; token: string; name: string };
type ChatMessage = { id: string; roomCode: string; playerId: string; playerName: string; text: string; at: number };
type VoiceParticipant = { playerId: string; playerName: string; muted: boolean; lastSeen: number };
type VoiceSignal = { id: number; senderId: string; targetId: string; kind: "offer" | "answer" | "ice"; payload: unknown };
type PeerEntry = { pc: RTCPeerConnection; iceQueue: RTCIceCandidateInit[] };
type Panel = "chat" | "voice" | null;

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
  } catch { return null; }
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
  return data as { ok: true; status: "lobby" | "playing" | "gameover"; messages: ChatMessage[] };
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
  return data as { ok: true; participants?: VoiceParticipant[]; signals?: VoiceSignal[]; cursor?: number };
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    void ref.current.play().catch(() => undefined);
    return () => { if (ref.current) ref.current.srcObject = null; };
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline/>;
}

export default function RoomCommsPersistent() {
  const [session, setSession] = useState<Session | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [unread, setUnread] = useState(0);
  const [notice, setNotice] = useState<ChatMessage | null>(null);

  const [voiceJoined, setVoiceJoined] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const listRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<Panel>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const chatInitializedRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const voiceCursorRef = useRef(0);
  const voiceJoinedRef = useRef(false);
  const voiceMutedRef = useRef(false);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => { panelRef.current = panel; if (panel === "chat") setUnread(0); }, [panel]);
  useEffect(() => { voiceJoinedRef.current = voiceJoined; }, [voiceJoined]);
  useEffect(() => { voiceMutedRef.current = voiceMuted; }, [voiceMuted]);
  useEffect(() => { sessionRef.current = session; }, [session]);

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
    const id = window.setInterval(sync, 600);
    return () => window.clearInterval(id);
  }, []);

  const closePeer = (playerId: string) => {
    const entry = peersRef.current.get(playerId);
    if (entry) {
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onconnectionstatechange = null;
      try { entry.pc.close(); } catch {}
      peersRef.current.delete(playerId);
    }
    setRemoteStreams((current) => {
      if (!current[playerId]) return current;
      const next = { ...current }; delete next[playerId]; return next;
    });
  };

  const stopVoiceLocally = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    for (const id of [...peersRef.current.keys()]) closePeer(id);
    peersRef.current.clear();
    setRemoteStreams({});
    setParticipants([]);
    setVoiceJoined(false); voiceJoinedRef.current = false;
    setVoiceMuted(false); voiceMutedRef.current = false;
    voiceCursorRef.current = 0;
  };

  useEffect(() => {
    // Ne coupe le vocal que si on QUITTE réellement la room ou qu'on change de room.
    const current = session;
    return () => {
      if (!current || !voiceJoinedRef.current) return;
      try {
        const blob = new Blob([JSON.stringify({ action: "leave", ...current })], { type: "application/json" });
        navigator.sendBeacon("/api/voice", blob);
      } catch {}
      stopVoiceLocally();
    };
  }, [session?.code, session?.playerId]);

  useEffect(() => {
    setMessages([]); setChatError(""); setUnread(0); setNotice(null);
    lastMessageIdRef.current = null; chatInitializedRef.current = false;
    if (!session) { setPanel(null); return; }
    let alive = true, inFlight = false;
    const poll = async () => {
      if (!alive || inFlight) return;
      inFlight = true;
      try {
        const data = await chatRequest(session, "state");
        if (!alive) return;
        setMessages(data.messages); setChatError("");
        const last = data.messages.at(-1)?.id ?? null;
        if (!chatInitializedRef.current) chatInitializedRef.current = true;
        else if (last && last !== lastMessageIdRef.current) {
          const oldIndex = lastMessageIdRef.current ? data.messages.findIndex((m) => m.id === lastMessageIdRef.current) : -1;
          const added = oldIndex >= 0 ? data.messages.slice(oldIndex + 1) : [data.messages[data.messages.length - 1]];
          const others = added.filter((m) => m.playerId !== session.playerId);
          if (others.length && panelRef.current !== "chat") {
            const latest = others[others.length - 1];
            setUnread((n) => Math.min(99, n + others.length));
            setNotice(latest);
            if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
            noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4200);
          }
        }
        lastMessageIdRef.current = last;
      } catch (e) { if (alive) setChatError(e instanceof Error ? e.message : "Chat indisponible."); }
      finally { inFlight = false; }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 1000);
    return () => { alive = false; window.clearInterval(id); };
  }, [session?.code, session?.playerId]);

  useEffect(() => {
    if (panel === "chat" && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [panel, messages.length]);

  const sendChat = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || !draft.trim() || chatBusy) return;
    try {
      setChatBusy(true); setChatError("");
      const data = await chatRequest(session, "send", draft.trim());
      setMessages(data.messages); setDraft(""); setUnread(0);
      lastMessageIdRef.current = data.messages.at(-1)?.id ?? null;
    } catch (e) { setChatError(e instanceof Error ? e.message : "Impossible d'envoyer."); }
    finally { setChatBusy(false); }
  };

  const sendVoiceSignal = async (targetId: string, kind: VoiceSignal["kind"], payload: unknown) => {
    const current = sessionRef.current;
    if (!current || !voiceJoinedRef.current) return;
    await voiceRequest(current, "signal", { targetId, kind, payload });
  };

  const flushIce = async (entry: PeerEntry) => {
    if (!entry.pc.remoteDescription) return;
    for (const candidate of entry.iceQueue.splice(0)) {
      try { await entry.pc.addIceCandidate(candidate); } catch {}
    }
  };

  const ensurePeer = async (otherId: string, initiator: boolean): Promise<PeerEntry | null> => {
    const current = sessionRef.current;
    if (!current || !voiceJoinedRef.current || !localStreamRef.current || otherId === current.playerId) return null;
    const existing = peersRef.current.get(otherId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry: PeerEntry = { pc, iceQueue: [] };
    peersRef.current.set(otherId, entry);
    for (const track of localStreamRef.current.getAudioTracks()) pc.addTrack(track, localStreamRef.current);
    pc.onicecandidate = (event) => { if (event.candidate) void sendVoiceSignal(otherId, "ice", event.candidate.toJSON()).catch(() => undefined); };
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteStreams((value) => ({ ...value, [otherId]: stream }));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") closePeer(otherId);
    };
    if (initiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendVoiceSignal(otherId, "offer", offer);
      } catch { closePeer(otherId); return null; }
    }
    return entry;
  };

  const handleSignal = async (signal: VoiceSignal) => {
    const current = sessionRef.current;
    if (!current || signal.senderId === current.playerId) return;
    if (signal.kind === "offer") {
      const entry = await ensurePeer(signal.senderId, false); if (!entry) return;
      try {
        if (entry.pc.signalingState === "have-local-offer") await entry.pc.setLocalDescription({ type: "rollback" });
        await entry.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
        await flushIce(entry);
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        await sendVoiceSignal(signal.senderId, "answer", answer);
      } catch { closePeer(signal.senderId); }
      return;
    }
    const entry = peersRef.current.get(signal.senderId) ?? await ensurePeer(signal.senderId, false);
    if (!entry) return;
    if (signal.kind === "answer") {
      try { if (entry.pc.signalingState === "have-local-offer") { await entry.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit); await flushIce(entry); } } catch { closePeer(signal.senderId); }
    } else {
      const candidate = signal.payload as RTCIceCandidateInit;
      if (entry.pc.remoteDescription) { try { await entry.pc.addIceCandidate(candidate); } catch {} }
      else entry.iceQueue.push(candidate);
    }
  };

  const syncPeers = async (people: VoiceParticipant[]) => {
    const current = sessionRef.current;
    if (!current || !voiceJoinedRef.current) return;
    const active = new Set(people.filter((p) => p.playerId !== current.playerId).map((p) => p.playerId));
    for (const id of [...peersRef.current.keys()]) if (!active.has(id)) closePeer(id);
    for (const person of people) {
      if (person.playerId === current.playerId || peersRef.current.has(person.playerId)) continue;
      if (current.playerId.localeCompare(person.playerId) < 0) await ensurePeer(person.playerId, true);
    }
  };

  const joinVoice = async () => {
    if (!session || voiceBusy) return;
    if (voiceJoinedRef.current) { setPanel("voice"); return; }
    try {
      setVoiceBusy(true); setVoiceError("");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Ton navigateur ne permet pas l'accès au micro.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      localStreamRef.current = stream;
      const data = await voiceRequest(session, "join", { muted: false });
      voiceCursorRef.current = Number(data.cursor ?? 0);
      setParticipants(data.participants ?? []);
      setVoiceJoined(true); voiceJoinedRef.current = true;
      setVoiceMuted(false); voiceMutedRef.current = false;
      setPanel("voice");
    } catch (e) {
      localStreamRef.current?.getTracks().forEach((track) => track.stop()); localStreamRef.current = null;
      setVoiceError(e instanceof Error ? e.message : "Impossible de rejoindre le vocal."); setPanel("voice");
    } finally { setVoiceBusy(false); }
  };

  const leaveVoice = async () => {
    const current = session;
    try { setVoiceBusy(true); if (current && voiceJoinedRef.current) await voiceRequest(current, "leave"); } catch {}
    finally { stopVoiceLocally(); setVoiceBusy(false); }
  };

  const toggleMute = () => {
    if (!voiceJoinedRef.current) return;
    const next = !voiceMutedRef.current;
    voiceMutedRef.current = next; setVoiceMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
  };

  useEffect(() => {
    if (!session || voiceJoined) return;
    let alive = true, inFlight = false;
    const peek = async () => {
      if (!alive || inFlight) return; inFlight = true;
      try { const data = await voiceRequest(session, "state"); if (alive) setParticipants(data.participants ?? []); }
      catch { if (alive) setParticipants([]); }
      finally { inFlight = false; }
    };
    void peek(); const id = window.setInterval(() => void peek(), 1800);
    return () => { alive = false; window.clearInterval(id); };
  }, [session?.code, session?.playerId, voiceJoined]);

  useEffect(() => {
    if (!session || !voiceJoined) return;
    let alive = true, inFlight = false;
    const poll = async () => {
      if (!alive || inFlight || !voiceJoinedRef.current) return; inFlight = true;
      try {
        const data = await voiceRequest(session, "poll", { after: voiceCursorRef.current, muted: voiceMutedRef.current });
        if (!alive) return;
        const people = data.participants ?? [], signals = data.signals ?? [];
        voiceCursorRef.current = Number(data.cursor ?? voiceCursorRef.current);
        setParticipants(people); setVoiceError("");
        for (const signal of signals) await handleSignal(signal);
        await syncPeers(people);
      } catch (e) { if (alive) setVoiceError(e instanceof Error ? e.message : "Connexion vocale instable."); }
      finally { inFlight = false; }
    };
    void poll(); const id = window.setInterval(() => void poll(), 750);
    return () => { alive = false; window.clearInterval(id); };
  }, [session?.code, session?.playerId, voiceJoined]);

  if (!session) return null;
  const voiceCount = participants.length;

  return <div className="gameChatRoot persistentRoomComms">
    {notice && panel !== "chat" && <button className="gameMessageToast" type="button" onClick={() => { setPanel("chat"); setNotice(null); setUnread(0); }}><span className="gameMessageToastIcon">💬</span><span><strong>{notice.playerName}</strong><small>{notice.text}</small></span></button>}

    {panel === "chat" && <section className="gameChatPanel" aria-label="Chat de la room">
      <div className="gameChatHeader"><div><strong>Chat de la room</strong><small>Il reste ouvert du lobby jusqu'à la fin</small></div><button type="button" className="gameChatClose" onClick={() => setPanel(null)}>×</button></div>
      <div className="gameChatMessages" ref={listRef}>{messages.length === 0 ? <div className="gameChatEmpty">Aucun message pour l'instant.</div> : messages.map((message) => {
        const own = message.playerId === session.playerId;
        return <div className={`gameChatMessage ${own ? "own" : ""}`} key={message.id}><div className="gameChatMeta"><strong>{own ? "Toi" : message.playerName}</strong><span>{new Date(message.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span></div><p>{message.text}</p></div>;
      })}</div>
      <form className="gameChatForm" onSubmit={sendChat}><input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} placeholder="Écris un message…"/><button disabled={chatBusy || !draft.trim()}>Envoyer</button></form>
      {chatError && <div className="gameChatError">{chatError}</div>}
    </section>}

    {panel === "voice" && <section className="gameChatPanel voicePanel" aria-label="Vocal de la room">
      <div className="gameChatHeader"><div><strong>Vocal de la room</strong><small>{voiceCount ? `${voiceCount} dans le vocal` : "Personne dans le vocal"}</small></div><button type="button" className="gameChatClose" onClick={() => setPanel(null)}>×</button></div>
      <div className="voiceBody">
        <div className={`voiceCallOrb ${voiceJoined ? "joined" : ""}`}><span>{voiceJoined ? "🎙" : "☎"}</span></div>
        <div className="voiceStatusText"><strong>{voiceJoined ? "Tu restes connecté à la room" : "Rejoins tes potes"}</strong><p>{voiceJoined ? "Lobby, partie et revanche : aucune reconnexion nécessaire." : "Le micro reste connecté tant que tu ne quittes pas la room."}</p></div>
        <div className="voicePeople">{participants.length === 0 ? <div className="voiceEmpty">Aucun participant pour l'instant.</div> : participants.map((person) => <div className="voicePerson" key={person.playerId}><span className="voiceAvatar">{person.playerName.slice(0,1).toUpperCase()}</span><div><strong>{person.playerId === session.playerId ? "Toi" : person.playerName}</strong><small>{person.muted ? "Micro coupé" : "Micro activé"}</small></div><span className={person.muted ? "voiceMic muted" : "voiceMic"}>{person.muted ? "🔇" : "🎙"}</span></div>)}</div>
        {!voiceJoined ? <button className="voiceJoinButton" disabled={voiceBusy} onClick={() => void joinVoice()}>{voiceBusy ? "Connexion…" : "Rejoindre l'appel"}</button> : <div className="voiceControls"><button className={voiceMuted ? "voiceControl muted" : "voiceControl"} onClick={toggleMute}>{voiceMuted ? "🔇 Réactiver" : "🎙 Couper le micro"}</button><button className="voiceHangup" disabled={voiceBusy} onClick={() => void leaveVoice()}>☎ Quitter</button></div>}
      </div>
      {voiceError && <div className="gameChatError">{voiceError}</div>}
    </section>}

    <div className="communicationLaunchers">
      <button type="button" className={`voiceLauncher ${panel === "voice" ? "opened" : ""} ${voiceJoined ? "inCall" : ""}`} onClick={() => { if (voiceJoined) setPanel(panel === "voice" ? null : "voice"); else void joinVoice(); }}><span>{voiceJoined ? (voiceMuted ? "🔇" : "🎙") : "🎙"}</span><span>Vocal</span>{voiceCount > 0 && <b>{voiceCount}</b>}</button>
      <button type="button" className={`gameChatLauncher ${panel === "chat" ? "opened" : ""}`} onClick={() => { const next = panel === "chat" ? null : "chat"; setPanel(next); if (next === "chat") { setUnread(0); setNotice(null); } }}><span className="gameChatBubbleIcon">💬</span><span>Chat</span>{unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}</button>
    </div>

    <div className="voiceAudioSinks" aria-hidden="true">{Object.entries(remoteStreams).map(([id, stream]) => <RemoteAudio key={id} stream={stream}/>)}</div>
  </div>;
}
