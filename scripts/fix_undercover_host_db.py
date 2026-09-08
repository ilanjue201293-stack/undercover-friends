from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "app/api/room/route.ts",
    '      } else if (action === "acceptJoinRequest") {',
    '''      } else if (action === "transferHost") {
        if (room.hostId !== player.id) throw new Error("Seul l'hôte peut transférer le rôle d'hôte.");
        const targetId = String(body.targetId ?? "");
        const target = room.players.find((candidate) => candidate.id === targetId);
        if (!target || target.id === player.id) throw new Error("Choisis un autre joueur.");
        if (!target.connected) throw new Error("Ce joueur doit être en ligne pour devenir hôte.");
        room.hostId = target.id;
        addEvent(room, `${player.name} a transféré le rôle d'hôte à ${target.name}.`, "info");
      } else if (action === "acceptJoinRequest") {''',
    "route transferHost",
)

replace_once(
    "app/page.tsx",
    '''          <div className="playerInfo"><strong>{p.name}{p.id === state.me.id ? " (toi)" : ""}</strong><span>{p.id === state.hostId ? "Hôte" : p.connected ? (p.ready ? "Prêt" : "Pas prêt") : "Hors ligne"}</span></div>
          <div className={`statusDot ${p.connected && p.ready ? "ready" : p.connected ? "online" : ""}`}/>
''',
    '''          <div className="playerInfo"><strong>{p.name}{p.id === state.me.id ? " (toi)" : ""}</strong><span>{p.id === state.hostId ? "Hôte" : p.connected ? (p.ready ? "Prêt" : "Pas prêt") : "Hors ligne"}</span></div>
          {state.me.isHost && p.id !== state.me.id && p.connected && <button className="transferHostButton" disabled={busy} onClick={() => { if (window.confirm(`Donner le rôle d'hôte à ${p.name} ?`)) void perform("transferHost", { targetId: p.id }); }}>Donner l'hôte</button>}
          <div className={`statusDot ${p.connected && p.ready ? "ready" : p.connected ? "online" : ""}`}/>
''',
    "page transfer button",
)

p = Path("app/page.tsx")
text = p.read_text()
text = text.replace("window.setInterval(() => void poll(), 2500)", "window.setInterval(() => void poll(), 5000)", 1)
text = text.replace("window.setInterval(() => void poll(), 850)", "window.setInterval(() => void poll(), 1500)", 1)
text = text.replace("window.setInterval(() => void poll(), 1000)", "window.setInterval(() => void poll(), 1400)", 1)
p.write_text(text)

p = Path("app/RoomCommsPersistent.tsx")
text = p.read_text()
if "window.setInterval(() => void poll(), 1000)" not in text:
    raise SystemExit("chat poll interval not found")
text = text.replace("window.setInterval(() => void poll(), 1000)", "window.setInterval(() => void poll(), 1600)", 1)
text = text.replace("window.setInterval(() => void peek(), 1800)", "window.setInterval(() => void peek(), 3000)", 1)
text = text.replace("window.setInterval(() => void poll(), 750)", "window.setInterval(() => void poll(), 1000)", 1)
p.write_text(text)

p = Path("app/upgrades.css")
css = p.read_text()
if ".transferHostButton" not in css:
    css += "\n.transferHostButton{border:1px solid #3a4650;background:#151c23;color:#9fefca;border-radius:9px;padding:7px 9px;font-size:8px;font-weight:900;white-space:nowrap;cursor:pointer}.transferHostButton:hover:not(:disabled){border-color:#63d8a6;background:#13251e}.transferHostButton:disabled{opacity:.45;cursor:not-allowed}@media(max-width:650px){.transferHostButton{grid-column:2/4;justify-self:start}}\n"
p.write_text(css)
