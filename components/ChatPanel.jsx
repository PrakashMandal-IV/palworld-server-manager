"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { api, Icon, toast } from "@/components/ui";

export default function ChatPanel({ worldId, running, onGoToUe4ss }) {
  const [messages, setMessages] = useState([]);
  const [announce, setAnnounce] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null); // { modInstalled, ue4ssInstalled, bundledAvailable, captureEnabled }
  const [installing, setInstalling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const boxRef = useRef(null);
  const esRef = useRef(null);

  const loadStatus = useCallback(() => {
    api(`/api/worlds/${worldId}/chat`).then((r) =>
      setStatus({
        modInstalled: r.modInstalled,
        ue4ssInstalled: r.ue4ssInstalled,
        bundledAvailable: r.bundledAvailable,
        captureEnabled: r.captureEnabled,
      })
    ).catch(() => {});
  }, [worldId]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const installMod = async () => {
    setInstalling(true);
    try {
      const r = await api(`/api/worlds/${worldId}/chat`, { method: "POST" });
      toast(r.ue4ssDetected
        ? "Chat mod installed. Restart the world to start capturing chat."
        : "Chat mod copied, but UE4SS was not detected — install UE4SS first.",
        r.ue4ssDetected ? "success" : "error");
      loadStatus();
    } catch (e) { toast(e.message, "error"); }
    finally { setInstalling(false); }
  };

  const removeMod = async () => {
    if (!confirm("Remove the chat relay mod from this server? Chat capture stops until you reinstall it. Restart the world to fully unload the mod.")) return;
    setRemoving(true);
    try {
      await api(`/api/worlds/${worldId}/chat`, { method: "DELETE" });
      toast("Chat relay mod removed. Restart the world to unload it.", "success");
      loadStatus();
    } catch (e) { toast(e.message, "error"); }
    finally { setRemoving(false); }
  };

  useEffect(() => {
    const es = new EventSource(`/api/worlds/${worldId}/chat/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data);
        setMessages((prev) => {
          const next = [...prev, entry];
          return next.length > 400 ? next.slice(-400) : next;
        });
      } catch {}
    };
    es.onerror = () => {};
    return () => es.close();
  }, [worldId]);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    if (!announce.trim()) return;
    setSending(true);
    try {
      await api(`/api/worlds/${worldId}/rest`, { method: "POST", body: { command: "announce", message: announce.trim() } });
      setAnnounce("");
      toast("Announcement sent", "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setSending(false); }
  };

  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const captureOff = status && status.captureEnabled === false;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 520 }}>
      {captureOff && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", marginBottom: "0.8rem", borderLeft: "3px solid var(--line-strong)" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>Chat capture is turned off</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: 0 }}>
            The in-game chat capture feature is disabled globally. Turn it back on in{" "}
            <Link href="/settings" style={{ color: "var(--accent)", fontWeight: 700 }}>Settings</Link> to read chat again.
          </p>
        </div>
      )}

      {/* Step 1: UE4SS missing → redirect the user to install it first. */}
      {!captureOff && status && !status.ue4ssInstalled && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", marginBottom: "0.8rem", borderLeft: "3px solid var(--yellow)" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>Chat capture needs UE4SS first</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 8px" }}>
            In-game chat is captured by a small UE4SS Lua mod. UE4SS (the Lua mod loader) isn’t
            installed on this world yet — install it first, then come back and add the chat relay mod.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" style={{ padding: "0.35rem 0.7rem" }} onClick={onGoToUe4ss}>
              <Icon name="shield" size={15} /> Install UE4SS →
            </button>
            <button className="btn btn-ghost" style={{ padding: "0.35rem 0.7rem" }}
              onClick={installMod} disabled={installing || !status.bundledAvailable}>
              {installing ? "Copying…" : "Copy chat mod anyway"}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: UE4SS present but the relay mod isn't installed yet. */}
      {!captureOff && status && status.ue4ssInstalled && !status.modInstalled && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", marginBottom: "0.8rem", borderLeft: "3px solid var(--yellow)" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>Install the chat relay mod</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 8px" }}>
            UE4SS is installed. Add the bundled chat relay mod, then restart the world to start capturing chat.
          </p>
          <button className="btn btn-primary" style={{ padding: "0.35rem 0.7rem" }}
            onClick={installMod} disabled={installing || !status.bundledAvailable}>
            <Icon name="download" size={15} /> {installing ? "Installing…" : "Install chat relay mod"}
          </button>
        </div>
      )}

      {/* Installed: show status + the remove escape hatch. */}
      {!captureOff && status && status.modInstalled && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", marginBottom: "0.6rem", flexWrap: "wrap" }}>
          <div className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem", flex: 1, minWidth: 200 }}>
            <span className="s-running">● Chat mod installed</span> — player messages appear here live while the world runs.
          </div>
          <button className="btn btn-danger" style={{ padding: "0.3rem 0.6rem", fontSize: "0.76rem" }}
            onClick={removeMod} disabled={removing}>
            <Icon name="trash" size={14} /> {removing ? "Removing…" : "Remove chat mod"}
          </button>
        </div>
      )}

      <div ref={boxRef} className="panel-inset" style={{ flex: 1, overflowY: "auto", padding: "0.8rem", marginBottom: "0.8rem" }}>
        {messages.length === 0 ? (
          <div className="subtle" style={{ fontWeight: 600, textAlign: "center", marginTop: "2rem" }}>
            No chat yet. In-game player messages appear here live while the world is running.
            {!running && <div style={{ marginTop: 8 }}>Start the world to capture chat.</div>}
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: "0.6rem", padding: "0.25rem 0", alignItems: "baseline" }}>
              <span className="subtle" style={{ fontSize: "0.68rem", fontWeight: 600, minWidth: 44 }}>{fmtTime(m.at)}</span>
              <span style={{ fontWeight: 800, color: "var(--accent)" }}>
                {m.channel && <span className="subtle" style={{ fontWeight: 700, marginRight: 4 }}>[{m.channel}]</span>}
                {m.name}
              </span>
              <span style={{ fontWeight: 500, wordBreak: "break-word" }}>{m.message}</span>
            </div>
          ))
        )}
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input className="input" placeholder={running ? "Broadcast an announcement to all players…" : "Start the world to broadcast"}
          value={announce} disabled={!running || sending}
          onChange={(e) => setAnnounce(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="btn btn-primary" onClick={send} disabled={!running || sending}>
          <Icon name="bell" size={16} /> Announce
        </button>
      </div>
      <p className="subtle" style={{ fontSize: "0.72rem", fontWeight: 600, marginTop: 6, marginBottom: 0 }}>
        Palworld has no REST endpoint to send as a player, so admin messages go out as a server announcement (broadcast to everyone).
      </p>
    </div>
  );
}
