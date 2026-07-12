"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { api, Icon, StatusChip, fmtUptime, toast } from "@/components/ui";
import CreateWorldModal from "@/components/CreateWorldModal";

const ACTION_TOAST = { start: "toast.worldStarted", stop: "toast.worldStopped", restart: "toast.worldRestarted" };

export default function WorldsPage() {
  const { t } = useTranslation();
  const [worlds, setWorlds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState({});
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const { worlds } = await api("/api/worlds");
      setWorlds(worlds);
    } catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  const doAction = async (id, action) => {
    setBusy((b) => ({ ...b, [id]: action }));
    try {
      await api(`/api/worlds/${id}/action`, { method: "POST", body: { action } });
      toast(t(ACTION_TOAST[action] || "toast.worldStarted"), "success");
      setTimeout(load, 600);
    } catch (e) { toast(e.message, "error"); }
    finally { setBusy((b) => ({ ...b, [id]: null })); }
  };

  const checkUpdates = async () => {
    setChecking(true);
    try {
      const r = await api("/api/updates/check");
      toast(r.latest ? t("worlds.latestBuild", { build: r.latest, count: r.worlds.length }) : t("worlds.steamUnreachable"), r.latest ? "success" : "error");
      load();
    } catch (e) { toast(e.message, "error"); }
    finally { setChecking(false); }
  };

  const running = worlds.filter((w) => w.running).length;
  const players = worlds.reduce((a, w) => a + (w.live?.currentPlayers || 0), 0);

  return (
    <div>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "1.2rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 className="heading" style={{ fontSize: "1.9rem", margin: 0 }}>{t("worlds.title")}</h1>
          <p className="subtle" style={{ margin: "0.2rem 0 0", fontWeight: 700 }}>
            {t("worlds.summary", { count: worlds.length, running, players })}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.6rem" }}>
          <button className="btn btn-ghost" onClick={checkUpdates} disabled={checking}>
            <Icon name="refresh" /> {checking ? t("common.checking") : t("worlds.checkUpdates")}
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Icon name="plus" /> {t("worlds.newWorld")}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="panel subtle" style={{ padding: "2rem", textAlign: "center" }}>{t("common.loading")}</div>
      ) : worlds.length === 0 ? (
        <EmptyState onCreate={() => setShowCreate(true)} />
      ) : (
        <div style={{ display: "grid", gap: "0.9rem" }}>
          {worlds.map((w) => (
            <WorldRow key={w.world_id} w={w} busy={busy[w.world_id]} onAction={doAction} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateWorldModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />
      )}
    </div>
  );
}

function WorldRow({ w, busy, onAction }) {
  const { t } = useTranslation();
  const isBusy = !!busy;
  const accent = w.accent_color || "var(--accent)";
  return (
    <div className="panel world-card animate-floatUp" style={{ position: "relative", padding: "1rem 1.1rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", overflow: "hidden", borderLeft: `3px solid ${accent}` }}>
      {/* banner: sits on the right, fades toward the center (|||| |  |) */}
      {w.banner_data && (
        <>
          <div aria-hidden style={{
            position: "absolute", inset: 0, zIndex: 0,
            backgroundImage: `url(${w.banner_data})`,
            backgroundSize: "cover", backgroundPosition: "left center",
            // fade from visible (left edge) to transparent (center) — |  | ||||
            WebkitMaskImage: "linear-gradient(to left, transparent 30%, rgba(0,0,0,0.35) 62%, rgba(0,0,0,0.75) 100%)",
            maskImage: "linear-gradient(to left, transparent 30%, rgba(0,0,0,0.35) 62%, rgba(0,0,0,0.75) 100%)",
            opacity: 0.85, pointerEvents: "none",
          }} />
          {/* left scrim keeps the icon + name readable over the banner */}
          <div aria-hidden style={{
            position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
            background: "linear-gradient(to right, var(--card) 8%, color-mix(in srgb, var(--card) 55%, transparent) 34%, transparent 52%)",
          }} />
        </>
      )}

      <div style={{ position: "relative", zIndex: 1, width: 46, height: 46, borderRadius: 10, background: w.icon_data ? "transparent" : accent, border: `1px solid ${w.icon_data ? "transparent" : "var(--line)"}`, display: "grid", placeItems: "center", flexShrink: 0, overflow: "hidden", boxShadow: w.icon_data ? "0 2px 8px rgba(0,0,0,0.3)" : "none" }}>
        {w.icon_data ? <img src={w.icon_data} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="globe" size={24} />}
      </div>

      <div style={{ position: "relative", zIndex: 1, flex: 1, minWidth: 200 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <Link href={`/worlds/${w.world_id}`} className="heading" style={{ fontSize: "1.15rem", textDecoration: "none" }}>
            {w.display_name}
          </Link>
          <StatusChip status={w.status} running={w.running} />
          {w.community_server ? (
            <span className="chip" style={{ background: "var(--green-bright)", color: "#0b3d1a" }} title={t("worlds.communityTip")}>{t("worlds.community")}</span>
          ) : (
            <span className="chip" style={{ background: "var(--line-strong)", color: "var(--ink-soft)" }} title={t("worlds.privateTip")}>{t("worlds.private")}</span>
          )}
          {w.updateAvailable && (
            <span className="chip" style={{ background: "var(--yellow)", color: "#1e1f22" }}>{t("worlds.updateAvailable")}</span>
          )}
        </div>
        <div className="subtle" style={{ fontSize: "0.78rem", fontWeight: 700, marginTop: 3 }}>
          {t("worlds.portsLine", { game: w.game_port, rest: w.rest_api_port, build: w.build_id || "—" })}
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1, display: "flex", gap: "1.4rem", textAlign: "center" }}>
        <Stat label={t("common.players")} value={w.live ? `${w.live.currentPlayers}${w.live.maxPlayers ? "/" + w.live.maxPlayers : ""}` : "—"} />
        <Stat label={t("common.uptime")} value={w.live ? fmtUptime(w.live.uptime) : "—"} />
        <Stat label={t("common.day")} value={w.live?.days ?? "—"} />
      </div>

      <div style={{ position: "relative", zIndex: 1, display: "flex", gap: "0.5rem", flexShrink: 0 }}>
        {w.running ? (
          <>
            <button className="btn btn-ghost" disabled={isBusy} onClick={() => onAction(w.world_id, "restart")} title={t("common.restart")}>
              <Icon name="restart" />
            </button>
            <button className="btn btn-danger" disabled={isBusy} onClick={() => onAction(w.world_id, "stop")} title={t("common.stop")}>
              <Icon name="stop" />
            </button>
          </>
        ) : (
          <button className="btn btn-primary" disabled={isBusy} onClick={() => onAction(w.world_id, "start")} title={t("common.start")}>
            <Icon name="play" /> {busy === "start" ? t("common.starting") : t("common.start")}
          </button>
        )}
        <Link href={`/worlds/${w.world_id}`} className="btn btn-ghost">{t("common.manage")}</Link>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="heading" style={{ fontSize: "1.05rem" }}>{value}</div>
      <div className="subtle" style={{ fontSize: "0.66rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
    </div>
  );
}

function EmptyState({ onCreate }) {
  const { t } = useTranslation();
  return (
    <div className="panel" style={{ padding: "3rem 2rem", textAlign: "center" }}>
      <div style={{ width: 66, height: 66, borderRadius: 8, background: "var(--yellow)", display: "grid", placeItems: "center", margin: "0 auto 1rem" }}>
        <Icon name="globe" size={34} />
      </div>
      <h2 className="heading" style={{ fontSize: "1.4rem", margin: "0 0 0.4rem" }}>{t("worlds.emptyTitle")}</h2>
      <p className="subtle" style={{ fontWeight: 700, maxWidth: 460, margin: "0 auto 1.3rem" }}>
        {t("worlds.emptyBody")}
      </p>
      <button className="btn btn-primary" onClick={onCreate}><Icon name="plus" /> {t("worlds.createWorld")}</button>
    </div>
  );
}
