"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, Icon, StatusChip, fmtUptime, fmtTime, toast } from "@/components/ui";
import PlayersPanel from "@/components/PlayersPanel";
import LogsPanel from "@/components/LogsPanel";
import CustomizeModal from "@/components/CustomizeModal";
import SettingsEditor from "@/components/SettingsEditor";
import BackupsPanel from "@/components/BackupsPanel";
import SchedulePanel from "@/components/SchedulePanel";
import ModsPanel from "@/components/ModsPanel";
import Ue4ssPanel from "@/components/Ue4ssPanel";
import AdminPanel from "@/components/AdminPanel";
import ChatPanel from "@/components/ChatPanel";
import BroadcastPanel from "@/components/BroadcastPanel";
import DiscordPanel from "@/components/DiscordPanel";

const TABS = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "players", label: "Players", icon: "users" },
  { id: "broadcast", label: "Broadcast", icon: "bell" },
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "console", label: "Console", icon: "terminal" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "backups", label: "Backups", icon: "download" },
  { id: "schedule", label: "Schedule", icon: "clock" },
  { id: "mods", label: "Mods", icon: "shield" },
  { id: "discord", label: "Discord", icon: "bell" },
  { id: "admin", label: "Admin", icon: "settings" },
];

export default function WorldDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(null);
  const [customizing, setCustomizing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api(`/api/worlds/${id}`)); }
    catch (e) { toast(e.message, "error"); }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (action) => {
    setBusy(action);
    try {
      await api(`/api/worlds/${id}/action`, { method: "POST", body: { action } });
      toast(`World ${action}ed`, "success");
      setTimeout(load, 700);
    } catch (e) { toast(e.message, "error"); }
    finally { setBusy(null); }
  };

  const doUpdate = async () => {
    setBusy("update");
    try {
      await api(`/api/worlds/${id}/update`, { method: "POST" });
      try { window.__palJobsPing?.(); } catch {}
      toast("Update started — track progress in the downloads tray", "success");
      // reflect status changes as the background job runs
      setTimeout(load, 1200);
    } catch (e) { toast(e.message, "error"); }
    finally { setBusy(null); }
  };


  if (!data) return <div className="subtle" style={{ fontWeight: 700 }}>Loading…</div>;
  const { world, live, events, sessions, schedules, backups } = data;
  const running = world.running;

  return (
    <div>
      <Link href="/" className="btn btn-ghost" style={{ marginBottom: "1rem" }}><Icon name="back" /> All worlds</Link>

      {/* Header */}
      <div className="panel" style={{ padding: 0, marginBottom: "1.2rem", overflow: "hidden", position: "relative", borderTop: `3px solid ${world.accent_color || "var(--accent)"}` }}>
        {/* banner: top strip, fades downward */}
        {world.banner_data && (
          <div aria-hidden style={{
            position: "absolute", top: 0, left: 0, right: 0, height: "68%", zIndex: 0,
            backgroundImage: `url(${world.banner_data})`, backgroundSize: "cover", backgroundPosition: "center 30%",
            WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 45%, rgba(0,0,0,0.3) 75%, transparent 100%)",
            maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 45%, rgba(0,0,0,0.3) 75%, transparent 100%)",
          }} />
        )}
        <div style={{ position: "relative", zIndex: 1, padding: "1.3rem 1.4rem", paddingTop: world.banner_data ? "6rem" : "1.3rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ width: 54, height: 54, borderRadius: 12, background: world.icon_data ? "transparent" : (world.accent_color || "var(--yellow)"), display: "grid", placeItems: "center", overflow: "hidden", boxShadow: world.icon_data ? "0 3px 12px rgba(0,0,0,0.4)" : "none", flexShrink: 0 }}>
            {world.icon_data ? <img src={world.icon_data} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="globe" size={28} />}
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
              <h1 className="heading" style={{ fontSize: "1.6rem", margin: 0 }}>{world.display_name}</h1>
              <StatusChip status={world.status} running={running} />
              {world.updateAvailable && <span className="chip" style={{ background: "var(--yellow)", color: "#1e1f22" }}>Update available</span>}
            </div>
            <div className="subtle" style={{ fontWeight: 700, fontSize: "0.8rem", marginTop: 3 }}>
              {live?.info?.servername || world.install_dir}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => setCustomizing(true)} title="Customize"><Icon name="image" /> Customize</button>
            {running ? (
              <>
                <button className="btn btn-ghost" disabled={busy} onClick={() => act("restart")}><Icon name="restart" /> Restart</button>
                <button className="btn btn-danger" disabled={busy} onClick={() => act("stop")}><Icon name="stop" /> Stop</button>
              </>
            ) : (
              <button className="btn btn-primary" disabled={busy} onClick={() => act("start")}><Icon name="play" /> {busy === "start" ? "Starting…" : "Start"}</button>
            )}
            <button className="btn btn-amber" disabled={busy || running || world.status === "updating"} onClick={doUpdate}><Icon name="download" /> {busy === "update" || world.status === "updating" ? "Updating…" : "Update"}</button>
          </div>
        </div>

        {/* quick stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: "0.8rem", marginTop: "1.1rem" }}>
          <QuickStat label="Players" value={live?.metrics ? `${live.metrics.currentplayernum ?? live.players?.players?.length ?? 0}${live.metrics.maxplayernum ? "/" + live.metrics.maxplayernum : ""}` : "—"} />
          <QuickStat label="Uptime" value={live?.metrics ? fmtUptime(live.metrics.uptime) : "—"} />
          <QuickStat label="In-game day" value={live?.metrics?.days ?? "—"} />
          <QuickStat label="Server FPS" value={live?.metrics?.serverfps ?? "—"} />
          <QuickStat label="Build" value={world.build_id || live?.info?.version || "—"} />
          <QuickStat label="Game port" value={world.game_port} />
        </div>

        {/* connection URL */}
        <ConnectionBar world={world} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.id} className={`btn ${tab === t.id ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={16} /> {t.label}
          </button>
        ))}
      </div>

      <div className="panel" style={{ padding: "1.3rem" }}>
        {tab === "overview" && <Overview world={world} live={live} events={events} sessions={sessions} onDelete={() => setDeleting(true)} />}
        {tab === "players" && <PlayersPanel worldId={id} players={live?.players} onChange={load} />}
        {tab === "broadcast" && <BroadcastPanel worldId={id} running={running} onGoToUe4ss={() => setTab("mods")} />}
        {tab === "chat" && <ChatPanel worldId={id} running={running} onGoToUe4ss={() => setTab("mods")} />}
        {tab === "console" && <LogsPanel worldId={id} />}
        {tab === "settings" && <SettingsEditor worldId={id} world={world} running={running} onGoToAdmin={() => setTab("admin")} />}
        {tab === "backups" && <BackupsPanel worldId={id} backups={backups} running={running} onChange={load} />}
        {tab === "schedule" && <SchedulePanel worldId={id} world={world} schedules={schedules} onChange={load} />}
        {tab === "mods" && (
          <div style={{ display: "grid", gap: "1.8rem" }}>
            <div>
              <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>Steam Workshop mods</h3>
              <ModsPanel worldId={id} running={running} />
            </div>
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: "1.4rem" }}>
              <Ue4ssPanel worldId={id} running={running} />
            </div>
          </div>
        )}
        {tab === "discord" && <DiscordPanel world={world} onChange={load} />}
        {tab === "admin" && <AdminPanel world={world} running={running} onChange={load} />}
      </div>

      {customizing && (
        <CustomizeModal world={world} onClose={() => setCustomizing(false)} onDone={() => { setCustomizing(false); load(); }} />
      )}

      {deleting && (
        <DeleteWorldModal world={world} onClose={() => setDeleting(false)} onDeleted={() => { toast("World deleted", "success"); router.push("/"); }} />
      )}
    </div>
  );
}

function DeleteWorldModal({ world, onClose, onDeleted }) {
  const [mode, setMode] = useState("profile"); // "profile" | "disk"
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const downOnBackdrop = useRef(false);

  const withFiles = mode === "disk";
  const nameOk = !withFiles || confirmName.trim() === world.display_name;

  const doDelete = async () => {
    if (!nameOk) return;
    setBusy(true);
    try {
      await api(`/api/worlds/${world.world_id}${withFiles ? "?files=1" : ""}`, { method: "DELETE" });
      onDeleted();
    } catch (e) { toast(e.message, "error"); setBusy(false); }
  };

  return (
    <div
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnBackdrop.current) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", zIndex: 60, padding: "1rem" }}>
      <div className="panel" style={{ width: "100%", maxWidth: 520, padding: "1.4rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
          <h3 className="heading" style={{ fontSize: "1.15rem", margin: 0 }}>Delete “{world.display_name}”</h3>
          <button className="btn btn-ghost" style={{ padding: "0.3rem 0.5rem" }} onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.82rem", marginTop: 0 }}>
          Choose what to remove. This cannot be undone.
        </p>

        <div style={{ display: "grid", gap: "0.6rem", margin: "1rem 0" }}>
          <DeleteOption
            active={mode === "profile"} onClick={() => setMode("profile")}
            title="Delete profile only"
            desc="Removes this world from the manager. Server files, saves, and mods on disk are kept — you can re-add the folder later." />
          <DeleteOption
            active={mode === "disk"} onClick={() => setMode("disk")}
            danger
            title="Delete profile + server files on disk"
            desc={`Permanently deletes the entire install folder (${world.install_dir}) including all saves and backups. There is no recovery.`} />
        </div>

        {withFiles && (
          <div style={{ marginBottom: "1rem" }}>
            <label className="label">
              Type <b style={{ color: "var(--ink)" }}>{world.display_name}</b> to confirm permanent deletion
            </label>
            <input className="input" value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
              placeholder={world.display_name} autoFocus
              style={{ borderColor: confirmName && !nameOk ? "var(--red)" : undefined }} />
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-danger" onClick={doDelete} disabled={busy || !nameOk}>
            <Icon name="trash" size={15} /> {busy ? "Deleting…" : withFiles ? "Delete everything" : "Delete profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteOption({ active, danger, title, desc, onClick }) {
  const accent = danger ? "var(--red)" : "var(--accent)";
  return (
    <button onClick={onClick} className="panel-inset" style={{
      textAlign: "left", padding: "0.8rem 1rem", cursor: "pointer", width: "100%",
      border: `1px solid ${active ? accent : "var(--line)"}`,
      borderLeft: `3px solid ${active ? accent : "var(--line)"}`,
      background: active ? "var(--card-2)" : "transparent",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <span style={{
          width: 16, height: 16, borderRadius: 999, flexShrink: 0,
          border: `2px solid ${active ? accent : "var(--line-strong)"}`,
          display: "grid", placeItems: "center",
        }}>
          {active && <span style={{ width: 8, height: 8, borderRadius: 999, background: accent }} />}
        </span>
        <span className="heading" style={{ fontSize: "0.9rem" }}>{title}</span>
      </div>
      <div className="subtle" style={{ fontWeight: 600, fontSize: "0.76rem", marginTop: 4, marginLeft: "1.2rem", wordBreak: "break-word" }}>{desc}</div>
    </button>
  );
}

function QuickStat({ label, value }) {
  return (
    <div className="panel-inset" style={{ padding: "0.7rem 0.9rem" }}>
      <div className="heading" style={{ fontSize: "1.25rem" }}>{value}</div>
      <div className="subtle" style={{ fontSize: "0.66rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
    </div>
  );
}

function ConnectionBar({ world }) {
  const [copied, setCopied] = useState(null);
  const [lan, setLan] = useState(null);
  const port = world.game_port;
  useEffect(() => { api("/api/netinfo").then((r) => setLan(r.lan || [])).catch(() => setLan([])); }, []);
  const copy = (text, which) => {
    try { navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(null), 1500); } catch {}
  };
  const primaryLan = lan && lan.find((a) => a.primary);
  return (
    <div style={{ marginTop: "1.1rem", display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ display: "grid", gap: "0.45rem", flex: 1, minWidth: 260 }}>
        {/* Same network (LAN) — the address other PCs on this network use. Shown first
            because it's what most people actually want and dispels the idea that the
            server only listens on 127.0.0.1. */}
        {primaryLan && (
          <ConnectRow label="Same network (LAN)" value={`${primaryLan.address}:${port}`} which="lan"
            copied={copied} onCopy={copy} accent />
        )}
        {/* This PC only — 127.0.0.1 works solely from the machine running the server. */}
        <ConnectRow label="This PC only" value={`127.0.0.1:${port}`} which="local" copied={copied} onCopy={copy} />
        {lan && lan.length > 1 && (
          <div className="subtle" style={{ fontSize: "0.68rem", fontWeight: 600 }}>
            Other network adapters:{" "}
            {lan.filter((a) => !a.primary).map((a) => `${a.address}`).join(", ")}
          </div>
        )}
        {lan && lan.length === 0 && (
          <div className="subtle" style={{ fontSize: "0.68rem", fontWeight: 600 }}>
            No LAN address detected — the server still listens on all network adapters; use this PC&apos;s IP from your OS network settings.
          </div>
        )}
      </div>
      <div className="subtle" style={{ fontSize: "0.72rem", fontWeight: 600, maxWidth: 320 }}>
        In Palworld: <b>Join Multiplayer → Connect via IP</b> and paste an address above.
        Players <b>on your network</b> use the <b>LAN</b> address; from this same PC use <b>127.0.0.1</b>.
        The server isn&apos;t bound to any one address — it listens on every adapter on port {port}.
        For friends <b>over the internet</b>, forward/tunnel UDP port {port} and share your public IP.
        <div style={{ marginTop: 6 }}>
          <a href="/info" style={{ color: "var(--accent)", fontWeight: 700, textDecoration: "none" }}>
            → Want friends to join over the internet? See the free playit.gg guide
          </a>
        </div>
      </div>
    </div>
  );
}

function ConnectRow({ label, value, which, copied, onCopy, accent }) {
  return (
    <div className="panel-inset" style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.55rem 0.9rem", borderLeft: accent ? "3px solid var(--accent)" : undefined }}>
      <Icon name="globe" size={16} />
      <div style={{ lineHeight: 1.2 }}>
        <div className="subtle" style={{ fontSize: "0.64rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
        <code style={{ fontSize: "0.95rem", fontWeight: 700 }}>{value}</code>
      </div>
      <button className="btn btn-ghost" style={{ marginLeft: "auto", padding: "0.35rem 0.7rem", fontSize: "0.78rem" }} onClick={() => onCopy(value, which)}>
        {copied === which ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

function Overview({ world, live, events, sessions, onDelete }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.4rem" }}>
      <div>
        <h3 className="heading" style={{ fontSize: "1rem", marginTop: 0 }}>Recent activity</h3>
        <div style={{ display: "grid", gap: "0.35rem", maxHeight: 300, overflow: "auto" }}>
          {events.length === 0 ? <p className="subtle" style={{ fontWeight: 700 }}>No events yet.</p> :
            events.map((e) => (
              <div key={e.id} className="panel-inset" style={{ padding: "0.45rem 0.7rem", fontSize: "0.8rem" }}>
                <span className="chip" style={{ background: "var(--card-2)", border: "1px solid var(--line)", marginRight: 8 }}>{e.kind}</span>
                <span style={{ fontWeight: 700 }}>{e.message}</span>
                <div className="subtle" style={{ fontSize: "0.68rem", fontWeight: 700 }}>{fmtTime(e.created_at)}</div>
              </div>
            ))}
        </div>
      </div>
      <div>
        <h3 className="heading" style={{ fontSize: "1rem", marginTop: 0 }}>Join / leave history</h3>
        <div style={{ display: "grid", gap: "0.35rem", maxHeight: 300, overflow: "auto" }}>
          {sessions.length === 0 ? <p className="subtle" style={{ fontWeight: 700 }}>No sessions recorded yet.</p> :
            sessions.map((s) => (
              <div key={s.id} className="panel-inset" style={{ padding: "0.45rem 0.7rem", fontSize: "0.8rem", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 800 }}>
                  <span className={s.event === "join" ? "s-running" : "s-crashed"}>{s.event === "join" ? "→ " : "← "}</span>
                  {s.player_name || s.user_id}
                </span>
                <span className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem" }}>{fmtTime(s.created_at)}</span>
              </div>
            ))}
        </div>

        <h3 className="heading" style={{ fontSize: "1rem", marginTop: "1.4rem" }}>Danger zone</h3>
        <button className="btn btn-danger" onClick={onDelete}><Icon name="trash" /> Delete world profile</button>
      </div>
    </div>
  );
}
