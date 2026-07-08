"use client";
import { useEffect, useState, useCallback } from "react";
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

const TABS = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "players", label: "Players", icon: "users" },
  { id: "console", label: "Console", icon: "terminal" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "backups", label: "Backups", icon: "download" },
  { id: "schedule", label: "Schedule", icon: "clock" },
  { id: "mods", label: "Mods", icon: "shield" },
  { id: "admin", label: "Admin", icon: "settings" },
];

export default function WorldDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(null);
  const [customizing, setCustomizing] = useState(false);

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

  const del = async () => {
    if (!confirm("Delete this world profile? (Server files on disk are kept.)")) return;
    try {
      await api(`/api/worlds/${id}`, { method: "DELETE" });
      toast("World deleted", "success");
      router.push("/");
    } catch (e) { toast(e.message, "error"); }
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
        {tab === "overview" && <Overview world={world} live={live} events={events} sessions={sessions} onDelete={del} />}
        {tab === "players" && <PlayersPanel worldId={id} players={live?.players} onChange={load} />}
        {tab === "console" && <LogsPanel worldId={id} />}
        {tab === "settings" && <SettingsEditor worldId={id} running={running} />}
        {tab === "backups" && <BackupsPanel worldId={id} backups={backups} running={running} onChange={load} />}
        {tab === "schedule" && <SchedulePanel worldId={id} schedules={schedules} onChange={load} />}
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
        {tab === "admin" && <AdminPanel world={world} running={running} onChange={load} />}
      </div>

      {customizing && (
        <CustomizeModal world={world} onClose={() => setCustomizing(false)} onDone={() => { setCustomizing(false); load(); }} />
      )}
    </div>
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
  const url = `127.0.0.1:${world.game_port}`;
  const copy = (text, which) => {
    try { navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(null), 1500); } catch {}
  };
  return (
    <div style={{ marginTop: "1.1rem", display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
      <div className="panel-inset" style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.55rem 0.9rem", flex: 1, minWidth: 260 }}>
        <Icon name="globe" size={16} />
        <div style={{ lineHeight: 1.2 }}>
          <div className="subtle" style={{ fontSize: "0.64rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>Connect (this PC)</div>
          <code style={{ fontSize: "0.95rem", fontWeight: 700 }}>{url}</code>
        </div>
        <button className="btn btn-ghost" style={{ marginLeft: "auto", padding: "0.35rem 0.7rem", fontSize: "0.78rem" }} onClick={() => copy(url, "local")}>
          {copied === "local" ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="subtle" style={{ fontSize: "0.72rem", fontWeight: 600, maxWidth: 320 }}>
        In Palworld: <b>Join Multiplayer → Connect via IP</b> and paste this. For friends over the internet, use your public IP or a hosting/port-forwarded address on port {world.game_port}.
        <div style={{ marginTop: 6 }}>
          <a href="/info" style={{ color: "var(--accent)", fontWeight: 700, textDecoration: "none" }}>
            → Want friends to join over the internet? See the free playit.gg guide
          </a>
        </div>
      </div>
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
