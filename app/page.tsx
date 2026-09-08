"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Session = { code: string; playerId: string; token: string; name: string };
type RoomAccess = "public" | "code" | "private";
type PendingJoin = { code: string; requestId: string; requestToken: string; name: string; status: "pending" | "rejected" };
type PublicRoomSummary = { code: string; hostName: string; players: number; connectedPlayers: number; mode: "impostor" | "mrwhite"; updatedAt: number };
type Settings = {
  mode: "impostor" | "mrwhite";
  roundsBeforeVote: number;
  clueTimeSec: number;
  voteTimeSec: number;
  actionTimeSec: number;
  keepCluesAfterVote: boolean;
  infiltratorsKnowEachOther: boolean;
  impostorKnowsRole: boolean;
  wordSource: "random" | "custom";
  customWordA: string;
  customWordB: string;
};
type PublicPlayer = {
  id: string;
  name: string;
  joinOrder: number;
  ready: boolean;
  connected: boolean;
  joinedMidGame: boolean;
  isSpectator: boolean;
  isEliminated: boolean;
  revealedRole: "civil" | "infiltrator" | null;
};
type JoinRequest = { id: string; name: string; createdAt: number };
type PublicState = {
  code: string;
  access: RoomAccess;
  status: "lobby" | "playing" | "gameover";
  hostId: string;
  settings: Settings;
  joinRequests: JoinRequest[];
  players: PublicPlayer[];
  me: {
    id: string;
    name: string;
    isHost: boolean;
    ready: boolean;
    connected: boolean;
    isSpectator: boolean;
    isEliminated: boolean;
    role: "civil" | "infiltrator" | "unknown" | null;
    word: string | null;
    revealAck: boolean;
    knownTeammateIds: string[];
  };
  game: null | {
    phase: "reveal" | "clue" | "vote" | "tiebreak-clue" | "tiebreak-vote" | "mrwhite-guess" | "gameover";
    cycle: number;
    clueRound: number;
    currentTurnId: string | null;
    order: string[];
    submittedVoterIds: string[];
    eligibleVoterIds: string[];
    allowedTargetIds: string[];
    clues: Array<{ id: string; playerId: string; text: string; cycle: number; round: number; kind: "normal" | "tiebreak"; at: number }>;
    tieCandidates: string[];
    tiebreakIteration: number;
    pendingMrWhiteId: string | null;
    phaseDeadline: number | null;
    mrWhiteThemeHint: string | null;
    lastVoteReveal: null | {
      at: number;
      votes: Array<{ voterId: string; targetId: string }>;
      tally: Record<string, number>;
      eliminatedId: string | null;
      tiedIds: string[];
    };
    winner: "civilians" | "infiltrators" | null;
    winReason: string | null;
    civilianWord: string | null;
    infiltratorWord: string | null;
    infiltratorCountInitial: number;
  };
  events: Array<{ id: string; at: number; text: string; kind: string }>;
  serverNow: number;
};

const SESSION_KEY = "undercover-session-v1";
const NAME_KEY = "undercover-name-v1";
const PENDING_KEY = "undercover-pending-v1";
const ACCESS_KEY = "undercover-access-v1";

async function request(payload: Record<string, unknown>) {
  const res = await fetch("/api/room", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "Une erreur est survenue.");
  return data;
}

function countInfiltrators(n: number) { return Math.max(1, Math.floor((n + 1) / 3)); }
function roleName(state: PublicState, role: string | null) {
  if (role === "civil") return "Civil";
  if (role === "infiltrator") return state.settings.mode === "mrwhite" ? "Mr White" : "Imposteur";
  return null;
}
function playerName(state: PublicState, id: string | null) { return state.players.find((p) => p.id === id)?.name ?? "?"; }
function accessLabel(access: RoomAccess) { return access === "public" ? "Publique" : access === "private" ? "Privée + validation" : "Sur code"; }
function timerLabel(value: number) { return value === 0 ? "Pas de timer" : `${value} secondes`; }

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState<PendingJoin | null>(null);
  const [state, setState] = useState<PublicState | null>(null);
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [createAccess, setCreateAccess] = useState<RoomAccess>("code");
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [clock, setClock] = useState(Date.now());
  const serverOffset = useRef(0);

  useEffect(() => {
    const savedName = localStorage.getItem(NAME_KEY);
    if (savedName) setNickname(savedName);
    const savedAccess = localStorage.getItem(ACCESS_KEY);
    if (savedAccess === "public" || savedAccess === "code" || savedAccess === "private") setCreateAccess(savedAccess);
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      try { setSession(JSON.parse(raw)); } catch { localStorage.removeItem(SESSION_KEY); }
    }
    const pendingRaw = localStorage.getItem(PENDING_KEY);
    if (pendingRaw) {
      try { setPending(JSON.parse(pendingRaw)); } catch { localStorage.removeItem(PENDING_KEY); }
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (session || pending) return;
    let alive = true;
    let running = false;
    const poll = async () => {
      if (!alive || running) return;
      running = true;
      try {
        const data = await request({ action: "publicRooms" });
        if (alive) setPublicRooms(data.rooms ?? []);
      } catch { if (alive) setPublicRooms([]); }
      finally { running = false; }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [session, pending]);

  useEffect(() => {
    if (!pending || session) return;
    let alive = true;
    let running = false;
    const poll = async () => {
      if (!alive || running) return;
      running = true;
      try {
        const data = await request({ action: "joinStatus", ...pending });
        if (!alive) return;
        if (data.session) {
          localStorage.removeItem(PENDING_KEY);
          localStorage.setItem(SESSION_KEY, JSON.stringify(data.session));
          setPending(null);
          setSession(data.session);
          setState(data.state);
          setError("");
        } else if (data.pending?.status === "rejected") {
          localStorage.removeItem(PENDING_KEY);
          setPending(null);
          setError("L'hôte a refusé ta demande d'accès.");
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Demande d'accès indisponible.";
        if (/expirée|introuvable|invalide/i.test(message)) {
          localStorage.removeItem(PENDING_KEY);
          if (alive) { setPending(null); setError(message); }
        }
      } finally { running = false; }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 1500);
    return () => { alive = false; window.clearInterval(id); };
  }, [pending, session]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    let polling = false;
    const poll = async () => {
      if (polling || !alive) return;
      polling = true;
      try {
        const data = await request({ action: "state", ...session });
        if (!alive) return;
        setState(data.state);
        serverOffset.current = data.state.serverNow - Date.now();
        setError("");
      } catch (e) {
        const message = e instanceof Error ? e.message : "Connexion perdue.";
        if (/introuvable|expirée|invalide/i.test(message)) {
          localStorage.removeItem(SESSION_KEY);
          if (alive) { setSession(null); setState(null); }
        } else if (alive) setError(message);
      } finally { polling = false; }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 1400);
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    const onPageHide = () => {
      try {
        const blob = new Blob([JSON.stringify({ action: "leaveSignal", ...session })], { type: "application/json" });
        navigator.sendBeacon("/api/room", blob);
      } catch {}
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [session]);

  const perform = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!session) return;
    try {
      setBusy(true); setError("");
      const data = await request({ action, ...session, ...extra });
      if (data.state) {
        setState(data.state);
        serverOffset.current = data.state.serverNow - Date.now();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur."); }
    finally { setBusy(false); }
  };

  const createRoom = async () => {
    const name = nickname.trim();
    if (name.length < 2) return setError("Choisis un pseudo d'au moins 2 caractères.");
    try {
      setBusy(true); setError("");
      const data = await request({ action: "create", name, access: createAccess });
      localStorage.setItem(NAME_KEY, name);
      localStorage.setItem(ACCESS_KEY, createAccess);
      localStorage.setItem(SESSION_KEY, JSON.stringify(data.session));
      setSession(data.session); setState(data.state);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur."); }
    finally { setBusy(false); }
  };

  const joinRoom = async (forcedCode?: string) => {
    const name = nickname.trim();
    const code = (forcedCode ?? joinCode).trim().toUpperCase();
    if (name.length < 2) return setError("Choisis un pseudo d'au moins 2 caractères.");
    if (code.length !== 5) return setError("Entre le code à 5 caractères.");
    try {
      setBusy(true); setError("");
      const data = await request({ action: "join", name, code });
      localStorage.setItem(NAME_KEY, name);
      if (data.pending) {
        const nextPending = data.pending as PendingJoin;
        localStorage.setItem(PENDING_KEY, JSON.stringify(nextPending));
        setPending(nextPending);
        setJoinCode("");
        return;
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(data.session));
      setSession(data.session); setState(data.state); setJoinCode("");
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur."); }
    finally { setBusy(false); }
  };

  const cancelPending = () => {
    localStorage.removeItem(PENDING_KEY);
    setPending(null);
    setError("");
  };

  const leaveRoom = () => {
    if (session) {
      try {
        const blob = new Blob([JSON.stringify({ action: "leaveSignal", ...session })], { type: "application/json" });
        navigator.sendBeacon("/api/room", blob);
      } catch {}
    }
    localStorage.removeItem(SESSION_KEY);
    setSession(null); setState(null); setError("");
  };

  if (!session && pending) {
    return <main className="landing pendingLanding">
      <section className="hero"><div className="eyebrow"><span className="dot"/> ROOM PRIVÉE</div><h1>UNDER<span>COVER</span></h1></section>
      <section className="entryCard pendingCard">
        <div className="loader"/>
        <h2>Demande envoyée</h2>
        <p>L'hôte de la room <strong>{pending.code}</strong> doit t'accepter avant que tu puisses entrer.</p>
        <small>Tu rejoindras automatiquement dès qu'il accepte.</small>
        <button className="ghostButton dangerText" onClick={cancelPending}>Annuler</button>
      </section>
    </main>;
  }

  if (!session) {
    return <Landing nickname={nickname} setNickname={setNickname} joinCode={joinCode} setJoinCode={setJoinCode} access={createAccess} setAccess={setCreateAccess} publicRooms={publicRooms} onCreate={createRoom} onJoin={joinRoom} busy={busy} error={error}/>;
  }

  if (!state) return <main className="shell centerPage"><div className="loader"/><p className="muted">Connexion à la room {session.code}…</p>{error && <div className="errorBox">{error}</div>}</main>;

  const remaining = state.game?.phaseDeadline ? Math.max(0, Math.ceil((state.game.phaseDeadline - (clock + serverOffset.current)) / 1000)) : null;

  return <main className="shell">
    <RoomHeader state={state} onLeave={leaveRoom} onCopy={() => navigator.clipboard?.writeText(state.code).then(() => setToast("Code copié")).catch(() => setToast(`Code : ${state.code}`))}/>
    {error && <div className="errorBox">{error}</div>}
    {toast && <div className="toast">{toast}</div>}
    {state.status === "lobby" ? <Lobby state={state} busy={busy} perform={perform}/> : <Game state={state} busy={busy} perform={perform} remaining={remaining}/>} 
  </main>;
}

function Landing(props: {
  nickname: string; setNickname: (s: string) => void;
  joinCode: string; setJoinCode: (s: string) => void;
  access: RoomAccess; setAccess: (v: RoomAccess) => void;
  publicRooms: PublicRoomSummary[];
  onCreate: () => void; onJoin: (code?: string) => void; busy: boolean; error: string;
}) {
  const submitJoin = (e: FormEvent) => { e.preventDefault(); props.onJoin(); };
  return <main className="landing">
    <section className="hero">
      <div className="eyebrow"><span className="dot"/> PARTIE ENTRE POTES</div>
      <h1>UNDER<span>COVER</span></h1>
      <p>Un mot. Des indices. Quelqu'un ment peut-être.</p>
    </section>

    <section className="entryCard">
      <label className="fieldLabel" htmlFor="nickname">Ton pseudo</label>
      <input id="nickname" className="textInput bigInput" value={props.nickname} maxLength={18} placeholder="Ex. Ilan" onChange={(e) => props.setNickname(e.target.value)}/>

      <label className="fieldLabel roomAccessLabel">Type de room</label>
      <div className="accessPicker">
        <button className={props.access === "public" ? "active" : ""} onClick={() => props.setAccess("public")}><strong>Publique</strong><small>Visible sur l'accueil</small></button>
        <button className={props.access === "code" ? "active" : ""} onClick={() => props.setAccess("code")}><strong>Sur code</strong><small>Le code suffit</small></button>
        <button className={props.access === "private" ? "active" : ""} onClick={() => props.setAccess("private")}><strong>Privée</strong><small>Code + accord hôte</small></button>
      </div>

      <button className="primaryButton full" onClick={props.onCreate} disabled={props.busy}>Créer une room</button>
      <div className="divider"><span>ou</span></div>
      <form onSubmit={submitJoin} className="joinRow">
        <input className="textInput codeInput" value={props.joinCode} maxLength={5} placeholder="ABCDE" onChange={(e) => props.setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}/>
        <button className="secondaryButton" disabled={props.busy}>Rejoindre</button>
      </form>
      {props.error && <div className="errorBox compact">{props.error}</div>}
    </section>

    <section className="publicRoomsPanel">
      <div className="panelTitle"><span>Rooms publiques</span><small>{props.publicRooms.length} DISPONIBLE{props.publicRooms.length > 1 ? "S" : ""}</small></div>
      {props.publicRooms.length === 0 ? <p className="muted">Aucune room publique pour l'instant.</p> : <div className="publicRoomList">
        {props.publicRooms.map((room) => <button key={room.code} className="publicRoomCard" disabled={props.busy || props.nickname.trim().length < 2} onClick={() => props.onJoin(room.code)}>
          <span><strong>{room.hostName}</strong><small>{room.mode === "mrwhite" ? "Mr White" : "Imposteur"}</small></span>
          <span><b>{room.connectedPlayers}</b> joueur{room.connectedPlayers > 1 ? "s" : ""}</span>
          <span className="publicJoin">Rejoindre →</span>
        </button>)}
      </div>}
      {props.nickname.trim().length < 2 && props.publicRooms.length > 0 && <small className="settingHelp">Entre d'abord ton pseudo pour rejoindre une room publique.</small>}
    </section>

    <div className="miniRules"><span>3+ joueurs</span><i>•</i><span>aucun compte</span><i>•</i><span>Imposteur & Mr White</span></div>
  </main>;
}

function RoomHeader({ state, onLeave, onCopy }: { state: PublicState; onLeave: () => void; onCopy: () => void }) {
  return <header className="roomHeader">
    <div className="brandSmall">UNDER<span>COVER</span></div>
    <button className="roomCode" onClick={onCopy} title="Copier le code"><small>{accessLabel(state.access).toUpperCase()}</small><strong>{state.code}</strong><span>⧉</span></button>
    <button className="ghostButton dangerText" onClick={onLeave}>Quitter</button>
  </header>;
}

function Lobby({ state, busy, perform }: { state: PublicState; busy: boolean; perform: (a: string, x?: Record<string, unknown>) => Promise<void> }) {
  const active = state.players.filter((p) => !p.isSpectator);
  const connectedActive = active.filter((p) => p.connected);
  const allReady = connectedActive.length >= 3 && connectedActive.every((p) => p.ready);
  const infiltrators = countInfiltrators(connectedActive.length);
  return <div className="lobbyGrid">
    <section className="mainColumn">
      <div className="sectionHead">
        <div><span className="kicker">LOBBY · {accessLabel(state.access).toUpperCase()}</span><h2>{connectedActive.length} joueur{connectedActive.length > 1 ? "s" : ""}</h2></div>
        <div className="countPill">{infiltrators} {state.settings.mode === "mrwhite" ? "Mr White" : "imposteur"}{infiltrators > 1 ? "s" : ""}</div>
      </div>

      {state.me.isHost && state.joinRequests.length > 0 && <section className="joinRequestsPanel">
        <div className="panelTitle"><span>Demandes d'accès</span><small>{state.joinRequests.length}</small></div>
        {state.joinRequests.map((request) => <div className="joinRequestRow" key={request.id}>
          <div className="avatar small">{request.name.slice(0,1).toUpperCase()}</div><strong>{request.name}</strong>
          <button disabled={busy} onClick={() => perform("acceptJoinRequest", { requestId: request.id })}>Accepter</button>
          <button className="declineJoin" disabled={busy} onClick={() => perform("rejectJoinRequest", { requestId: request.id })}>Refuser</button>
        </div>)}
      </section>}

      <div className="playerGrid">
        {[...state.players].sort((a,b) => a.joinOrder-b.joinOrder).map((p) => <div className={`playerCard ${!p.connected ? "offline" : ""}`} key={p.id}>
          <div className="avatar">{p.name.slice(0,1).toUpperCase()}</div>
          <div className="playerInfo"><strong>{p.name}{p.id === state.me.id ? " (toi)" : ""}</strong><span>{p.id === state.hostId ? "Hôte" : p.connected ? (p.ready ? "Prêt" : "Pas prêt") : "Hors ligne"}</span></div>
          {state.me.isHost && p.id !== state.me.id && p.connected && <button className="transferHostButton" disabled={busy} onClick={() => { if (window.confirm(`Donner le rôle d'hôte à ${p.name} ?`)) void perform("transferHost", { targetId: p.id }); }}>Donner l'hôte</button>}
          <div className={`statusDot ${p.connected && p.ready ? "ready" : p.connected ? "online" : ""}`}/>
        </div>)}
      </div>

      <div className="readyBar">
        <button className={state.me.ready ? "secondaryButton readyButton" : "primaryButton"} disabled={busy || state.me.isSpectator} onClick={() => perform("ready", { ready: !state.me.ready })}>{state.me.ready ? "✓ Prêt" : "Je suis prêt"}</button>
        {state.me.isHost ? <button className="launchButton" disabled={busy || !allReady} onClick={() => perform("start")}>{allReady ? "Lancer la partie →" : connectedActive.length < 3 ? "3 joueurs minimum" : "En attente des joueurs"}</button> : <div className="waitingText">{allReady ? "Tout le monde est prêt — l'hôte peut lancer." : "Mets-toi prêt quand tu as fini de regarder les règles."}</div>}
      </div>
    </section>

    <aside className="sideColumn">
      {state.me.isHost ? <HostSettings state={state} busy={busy} perform={perform}/> : <ReadOnlySettings state={state}/>} 
      <Activity state={state}/>
    </aside>
  </div>;
}

function HostSettings({ state, busy, perform }: { state: PublicState; busy: boolean; perform: (a: string, x?: Record<string, unknown>) => Promise<void> }) {
  const s = state.settings;
  const [wordA, setWordA] = useState(s.customWordA);
  const [wordB, setWordB] = useState(s.customWordB);
  useEffect(() => { setWordA(s.customWordA); setWordB(s.customWordB); }, [s.customWordA, s.customWordB]);
  const patch = (settings: Partial<Settings>) => perform("settings", { settings });
  const timers = [0,15,20,25,30,40,45,60,90,120];
  return <section className="settingsPanel">
    <div className="panelTitle"><span>Réglages</span><small>HÔTE</small></div>

    <label className="settingLabel">Mode de jeu</label>
    <div className="segmented">
      <button className={s.mode === "impostor" ? "active" : ""} onClick={() => patch({ mode: "impostor" })} disabled={busy}>Imposteur</button>
      <button className={s.mode === "mrwhite" ? "active" : ""} onClick={() => patch({ mode: "mrwhite" })} disabled={busy || s.wordSource === "custom"}>Mr White</button>
    </div>
    {s.wordSource === "custom" && <p className="settingHelp">Mr White est désactivé avec les mots personnalisés.</p>}
    <p className="settingHelp">{s.mode === "impostor" ? "Les infiltrés ont un mot proche de celui des civils." : "Mr White sait son rôle mais ne reçoit aucun mot."}</p>

    {s.mode === "impostor" && <>
      <label className="settingLabel">Choix des mots</label>
      <div className="segmented">
        <button className={s.wordSource === "random" ? "active" : ""} onClick={() => patch({ wordSource: "random" })} disabled={busy}>Aléatoires</button>
        <button className={s.wordSource === "custom" ? "active" : ""} onClick={() => patch({ wordSource: "custom" })} disabled={busy}>Personnalisés</button>
      </div>
      {s.wordSource === "custom" ? <div className="customWords">
        <input className="textInput" value={wordA} maxLength={40} placeholder="Mot A" onChange={(e) => setWordA(e.target.value)}/>
        <input className="textInput" value={wordB} maxLength={40} placeholder="Mot B" onChange={(e) => setWordB(e.target.value)}/>
        <button className="tinyButton" disabled={busy || !wordA.trim() || !wordB.trim()} onClick={() => patch({ customWordA: wordA, customWordB: wordB })}>Enregistrer les 2 mots</button>
        <p className="settingHelp">Le jeu choisit au hasard le mot civil. Mr White est impossible dans ce mode.</p>
      </div> : <Toggle label="L'imposteur sait qu'il l'est" checked={s.impostorKnowsRole} onChange={(v) => patch({ impostorKnowsRole: v })} disabled={busy}/>} 
    </>}

    <div className="settingSplit">
      <div><label className="settingLabel">Manches avant vote</label><div className="stepper"><button onClick={() => patch({ roundsBeforeVote: s.roundsBeforeVote-1 })} disabled={busy || s.roundsBeforeVote<=1}>−</button><strong>{s.roundsBeforeVote}</strong><button onClick={() => patch({ roundsBeforeVote: s.roundsBeforeVote+1 })} disabled={busy || s.roundsBeforeVote>=4}>+</button></div></div>
      <div><label className="settingLabel">Timer indices</label><select className="selectInput" value={s.clueTimeSec} onChange={(e) => patch({ clueTimeSec: Number(e.target.value) })} disabled={busy}>{timers.map((v) => <option value={v} key={v}>{v === 0 ? "Pas de timer" : `${v}s`}</option>)}</select></div>
    </div>
    <div className="settingSplit oneTimerRow">
      <div><label className="settingLabel">Timer vote</label><select className="selectInput" value={s.voteTimeSec} onChange={(e) => patch({ voteTimeSec: Number(e.target.value) })} disabled={busy}>{timers.map((v) => <option value={v} key={v}>{v === 0 ? "Pas de timer" : `${v}s`}</option>)}</select></div>
    </div>

    <Toggle label="Garder les indices après le vote" checked={s.keepCluesAfterVote} onChange={(v) => patch({ keepCluesAfterVote: v })} disabled={busy}/>
    <Toggle label="Les infiltrés se connaissent" checked={s.infiltratorsKnowEachOther} onChange={(v) => patch({ infiltratorsKnowEachOther: v })} disabled={busy || (s.mode === "impostor" && !s.impostorKnowsRole)} hint={s.mode === "impostor" && !s.impostorKnowsRole ? "Impossible si l'imposteur ne sait pas qu'il l'est." : undefined}/>
  </section>;
}

function Toggle({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v:boolean)=>void; disabled?: boolean; hint?: string }) {
  return <div className="toggleWrap"><button className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} disabled={disabled} aria-pressed={checked}><span/></button><div><strong>{label}</strong>{hint && <small>{hint}</small>}</div></div>;
}

function ReadOnlySettings({ state }: { state: PublicState }) {
  const s = state.settings;
  return <section className="settingsPanel readonly">
    <div className="panelTitle"><span>Règles de la room</span></div>
    <RuleRow a="Accès" b={accessLabel(state.access)}/>
    <RuleRow a="Mode" b={s.mode === "mrwhite" ? "Mr White" : "Imposteur"}/>
    <RuleRow a="Mots" b={s.mode === "mrwhite" ? "Mot civil aléatoire" : s.wordSource === "custom" ? "2 mots personnalisés" : "Aléatoires"}/>
    {s.mode === "impostor" && <RuleRow a="Rôle imposteur" b={s.impostorKnowsRole ? "Connu" : "Caché"}/>} 
    <RuleRow a="Manches" b={`${s.roundsBeforeVote} avant chaque vote`}/>
    <RuleRow a="Indice" b={timerLabel(s.clueTimeSec)}/>
    <RuleRow a="Vote" b={timerLabel(s.voteTimeSec)}/>
    <RuleRow a="Historique" b={s.keepCluesAfterVote ? "Conservé" : "Effacé après vote"}/>
    <RuleRow a="Infiltrés" b={s.infiltratorsKnowEachOther ? "Se connaissent" : "Ne se connaissent pas"}/>
  </section>;
}
function RuleRow({ a,b }: { a:string; b:string }) { return <div className="ruleRow"><span>{a}</span><strong>{b}</strong></div>; }

function Game({ state, busy, perform, remaining }: { state: PublicState; busy: boolean; perform:(a:string,x?:Record<string,unknown>)=>Promise<void>; remaining:number|null }) {
  const g = state.game!;
  return <div className="gameGrid">
    <section className="gameMain">
      {state.me.isSpectator && !state.me.isEliminated && <div className="spectatorBanner">👁 Tu as rejoint en cours de partie : tu es spectateur jusqu'à la prochaine.</div>}
      {state.me.isEliminated && g.phase !== "mrwhite-guess" && <div className="spectatorBanner">👁 Tu es éliminé : tu peux suivre toute la partie en spectateur.</div>}
      <PhaseHeader state={state} remaining={remaining}/>
      <PhaseContent state={state} busy={busy} perform={perform} remaining={remaining}/>
      {g.lastVoteReveal && <VoteRevealCard state={state}/>} 
      {g.clues.length > 0 && <Clues state={state}/>} 
    </section>
    <aside className="sideColumn gameSide"><PlayersInGame state={state}/><Activity state={state}/></aside>
  </div>;
}

function PhaseHeader({ state, remaining }: { state: PublicState; remaining:number|null }) {
  const g = state.game!;
  let eyebrow = `CYCLE ${g.cycle}`, title = "";
  if (g.phase === "reveal") { eyebrow="DÉBUT DE PARTIE"; title="Découvre ton rôle"; }
  if (g.phase === "clue") title=`Manche ${g.clueRound}/${state.settings.roundsBeforeVote}`;
  if (g.phase === "vote") { eyebrow="VOTE"; title="Qui est suspect ?"; }
  if (g.phase === "tiebreak-clue") { eyebrow=`ÉGALITÉ · DÉPARTAGE ${g.tiebreakIteration}`; title="Indices supplémentaires"; }
  if (g.phase === "tiebreak-vote") { eyebrow=`ÉGALITÉ · DÉPARTAGE ${g.tiebreakIteration}`; title="Revote"; }
  if (g.phase === "mrwhite-guess") { eyebrow="DERNIÈRE CHANCE"; title="Mr White peut encore gagner"; }
  if (g.phase === "gameover") { eyebrow="PARTIE TERMINÉE"; title=g.winner === "civilians" ? "Victoire des civils" : `Victoire des ${state.settings.mode === "mrwhite" ? "Mr White" : "imposteurs"}`; }
  return <div className="phaseHeader"><div><span className="kicker">{eyebrow}</span><h2>{title}</h2></div>{remaining !== null && <div className={`timer ${remaining<=5 ? "urgent" : ""}`}><span>{remaining}</span><small>sec</small></div>}</div>;
}

function PhaseContent({ state,busy,perform,remaining }: { state:PublicState; busy:boolean; perform:(a:string,x?:Record<string,unknown>)=>Promise<void>; remaining:number|null }) {
  const g=state.game!;
  if (g.phase === "reveal") return <Reveal state={state} busy={busy} perform={perform}/>;
  if (g.phase === "clue" || g.phase === "tiebreak-clue") return <ClueTurn state={state} busy={busy} perform={perform} remaining={remaining}/>;
  if (g.phase === "vote" || g.phase === "tiebreak-vote") return <Vote state={state} busy={busy} perform={perform}/>;
  if (g.phase === "mrwhite-guess") return <MrWhiteGuess state={state} busy={busy} perform={perform}/>;
  return <GameOver state={state} busy={busy} perform={perform}/>;
}

function Reveal({ state,busy,perform }: { state:PublicState; busy:boolean; perform:(a:string,x?:Record<string,unknown>)=>Promise<void> }) {
  const [revealed,setRevealed]=useState(false);
  if (state.me.isSpectator) return <div className="waitingCard"><div className="pulseIcon">◌</div><strong>La partie se prépare</strong><p>Les joueurs découvrent leur rôle.</p></div>;
  if (state.me.revealAck) return <div className="waitingCard"><div className="pulseIcon">✓</div><strong>Rôle mémorisé</strong><p>On attend que les autres aient vu le leur.</p></div>;
  const visibleRole=roleName(state,state.me.role), isMrWhite=state.settings.mode === "mrwhite" && state.me.role === "infiltrator";
  const teammates=state.me.knownTeammateIds.map((id)=>playerName(state,id));
  return <div className="secretWrap">{!revealed ? <button className="secretCover" onClick={()=>setRevealed(true)}><span>◉</span><strong>Révéler mon rôle</strong><small>Assure-toi que personne ne regarde ton écran.</small></button> : <div className={`secretCard ${isMrWhite ? "whiteRole" : ""}`}>
    {visibleRole && <div className="roleTag">{visibleRole}</div>}
    {isMrWhite ? <><h3>Tu es Mr White</h3><div className="noWord">AUCUN MOT</div><p>Bluffe grâce aux indices des autres.</p></> : <><small>TON MOT</small><h3>{state.me.word}</h3>{state.me.role === "unknown" && <p>Tu ne sais pas si ton mot est celui des civils ou celui des imposteurs.</p>}</>}
    {teammates.length>0 && <div className="teammates">Avec toi : <strong>{teammates.join(", ")}</strong></div>}
    <button className="primaryButton" disabled={busy} onClick={()=>perform("ackReveal")}>J'ai compris</button>
  </div>}</div>;
}

function ClueTurn({ state,busy,perform,remaining }: { state:PublicState; busy:boolean; perform:(a:string,x?:Record<string,unknown>)=>Promise<void>; remaining:number|null }) {
  const g=state.game!, [clue,setClue]=useState("");
  const isMe=g.currentTurnId===state.me.id && !state.me.isSpectator, current=playerName(state,g.currentTurnId), isTie=g.phase === "tiebreak-clue";
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!clue.trim())return;await perform("clue",{clue});setClue("");};
  if(!isMe) return <div className="turnCard"><div className="turnAvatar">{current.slice(0,1).toUpperCase()}</div><div><small>{isTie?"INDICE DE DÉPARTAGE":"À SON TOUR"}</small><h3>{current}</h3><p>{state.me.isSpectator?"Tu regardes la partie.":"Prépare déjà ton prochain indice."}</p></div></div>;
  return <form className="yourTurn" onSubmit={submit}>
    <div className="yourTurnTop"><span className="liveDot"/> À TOI{remaining!==null?` · ${remaining}s`:""}</div>
    <h3>{isTie?"Donne un nouvel indice pour te défendre":"Donne ton indice"}</h3>
    {g.mrWhiteThemeHint && <div className="mrWhiteThemeHint"><span>INDICE SECRET MR WHITE</span><strong>Thème : {g.mrWhiteThemeHint}</strong><p>Tu commences : utilise seulement ce thème très large pour éviter un indice complètement hors sujet.</p></div>}
    <p>Un mot ou une très courte phrase. Un indice déjà utilisé sera refusé.</p>
    <div className="clueInputRow"><input autoFocus className="textInput clueInput" value={clue} maxLength={60} placeholder="Ton indice…" onChange={(e)=>setClue(e.target.value)}/><button className="primaryButton" disabled={busy||!clue.trim()}>Envoyer</button></div>
  </form>;
}

function Vote({ state,busy,perform }: { state:PublicState; busy:boolean; perform:(a:string,x?:Record<string,unknown>)=>Promise<void> }) {
  const g=state.game!, hasVoted=g.submittedVoterIds.includes(state.me.id), eligible=g.eligibleVoterIds.includes(state.me.id)&&!state.me.isSpectator;
  const targetPlayers=state.players.filter((p)=>g.allowedTargetIds.includes(p.id)), isTie=g.phase === "tiebreak-vote";
  if(!eligible) return <div className="waitingCard"><div className="pulseIcon">⌁</div><strong>{isTie?"Tu ne votes pas pendant ce départage":"Vote en cours"}</strong><p>{isTie?"Les joueurs à égalité attendent le choix des autres.":"Tu regardes les votes arriver."}</p><VoteProgress state={state}/></div>;
  if(hasVoted) return <div className="waitingCard"><div className="pulseIcon">✓</div><strong>Vote envoyé</strong><p>Ton choix reste secret jusqu'à la fin.</p><VoteProgress state={state}/></div>;
  return <div className="voteBox"><p>{isTie?"Choisis qui éliminer parmi les joueurs encore à égalité.":"Choisis la personne que tu veux éliminer. Tu peux voter pour toi-même."}</p><div className="voteTargets">{targetPlayers.map((p)=><button key={p.id} className="voteTarget" disabled={busy} onClick={()=>perform("vote",{targetId:p.id})}><span className="avatar small">{p.name.slice(0,1).toUpperCase()}</span><strong>{p.name}{p.id===state.me.id?" (toi)":""}</strong><span>Voter →</span></button>)}</div><VoteProgress state={state}/></div>;
}
function VoteProgress({state}:{state:PublicState}){const g=state.game!,connected=g.eligibleVoterIds.filter((id)=>state.players.find((p)=>p.id===id)?.connected),submitted=connected.filter((id)=>g.submittedVoterIds.includes(id)).length;return <div className="voteProgress"><div><span style={{width:`${connected.length?(submitted/connected.length)*100:0}%`}}/></div><small>{submitted}/{connected.length} votes reçus</small></div>;}

function MrWhiteGuess({state,busy,perform}:{state:PublicState;busy:boolean;perform:(a:string,x?:Record<string,unknown>)=>Promise<void>}){const g=state.game!,[guess,setGuess]=useState(""),isMe=g.pendingMrWhiteId===state.me.id,name=playerName(state,g.pendingMrWhiteId);if(!isMe)return <div className="waitingCard"><div className="pulseIcon">?</div><strong>{name} tente de deviner le mot</strong><p>S'il trouve exactement le mot civil, les Mr White gagnent.</p></div>;return <form className="guessCard" onSubmit={(e)=>{e.preventDefault();if(guess.trim())perform("mrwhiteGuess",{guess});}}><div className="roleTag">MR WHITE</div><h3>Une seule tentative.</h3><p>Écris le mot exact des civils. Les majuscules/minuscules ne comptent pas.</p><div className="clueInputRow"><input autoFocus className="textInput clueInput" maxLength={60} value={guess} onChange={(e)=>setGuess(e.target.value)} placeholder="Mot des civils…"/><button className="primaryButton" disabled={busy||!guess.trim()}>Valider</button></div></form>;}

function GameOver({state,busy,perform}:{state:PublicState;busy:boolean;perform:(a:string,x?:Record<string,unknown>)=>Promise<void>}){const g=state.game!,infiltrators=state.players.filter((p)=>p.revealedRole==="infiltrator");return <div className={`gameOverCard ${g.winner==="infiltrators"?"infilWin":""}`}><div className="winnerIcon">{g.winner==="civilians"?"✓":"◈"}</div><h3>{g.winner==="civilians"?"Les civils gagnent":`${state.settings.mode==="mrwhite"?"Mr White":"Les imposteurs"} gagnent`}</h3><p>{g.winReason}</p><div className="wordReveal"><div><small>MOT CIVIL</small><strong>{g.civilianWord}</strong></div>{state.settings.mode==="impostor"&&<div><small>MOT IMPOSTEUR</small><strong>{g.infiltratorWord}</strong></div>}</div><div className="infilReveal"><small>{state.settings.mode==="mrwhite"?"MR WHITE":"IMPOSTEUR(S)"}</small><strong>{infiltrators.map((p)=>p.name).join(", ")}</strong></div>{state.me.isHost?<button className="primaryButton" disabled={busy} onClick={()=>perform("reset")}>Rejouer avec la room</button>:<div className="waitingText">L'hôte peut relancer une partie.</div>}</div>;}

function VoteRevealCard({state}:{state:PublicState}){const r=state.game!.lastVoteReveal!;if(r.votes.length===0)return <div className="voteReveal"><strong>Dernier vote : aucun vote reçu.</strong></div>;return <details className="voteReveal" open={state.game!.phase==="tiebreak-clue"||state.game!.phase==="tiebreak-vote"}><summary>Résultat du dernier vote <span>{r.tiedIds.length?"Égalité":r.eliminatedId?`${playerName(state,r.eliminatedId)} éliminé`:""}</span></summary><div className="voteLines">{r.votes.map((v,i)=><div key={`${v.voterId}-${i}`}><strong>{playerName(state,v.voterId)}</strong><span>→</span><strong>{playerName(state,v.targetId)}</strong></div>)}</div></details>;}

function Clues({state}:{state:PublicState}){const g=state.game!;const groups=useMemo(()=>{const map=new Map<string,typeof g.clues>();for(const clue of g.clues){const key=clue.kind==="tiebreak"?`Départage ${clue.cycle}`:`Cycle ${clue.cycle} · Manche ${clue.round}`;const arr=map.get(key)??[];arr.push(clue);map.set(key,arr);}return [...map.entries()];},[g.clues]);return <section className="clueHistory"><div className="historyTitle">Indices visibles</div>{groups.map(([label,clues])=><div className="clueGroup" key={label}><small>{label}</small><div className="clueChips">{clues.map((c)=><div className="clueChip" key={c.id}><span>{playerName(state,c.playerId)}</span><strong>{c.text}</strong></div>)}</div></div>)}</section>;}

function PlayersInGame({state}:{state:PublicState}){return <section className="playersPanel"><div className="panelTitle"><span>Joueurs</span><small>{state.players.filter((p)=>p.connected).length} EN LIGNE</small></div><div className="sidePlayers">{[...state.players].sort((a,b)=>a.joinOrder-b.joinOrder).map((p)=><div className={`sidePlayer ${!p.connected?"offline":""}`} key={p.id}><span className="avatar tiny">{p.name.slice(0,1).toUpperCase()}</span><div><strong>{p.name}{p.id===state.me.id?" (toi)":""}</strong><small>{p.id===state.hostId?"Hôte":p.isEliminated?roleName(state,p.revealedRole)??"Éliminé":p.isSpectator?"Spectateur":p.connected?"En jeu":"Absent"}</small></div>{p.isEliminated&&<span className="skull">×</span>}</div>)}</div></section>;}

function Activity({state}:{state:PublicState}){const events=[...state.events].reverse().slice(0,12);return <section className="activityPanel"><div className="panelTitle"><span>Activité</span></div><div className="activityList">{events.length===0?<p className="muted">Rien pour l'instant.</p>:events.map((e)=><div className={`activityItem ${e.kind}`} key={e.id}><span/><p>{e.text}</p></div>)}</div></section>;}
