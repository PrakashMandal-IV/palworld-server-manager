"use client";
import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";

export default function AdminPanel({ world, running, onChange }) {
  const { t } = useTranslation();
  const [announce, setAnnounce] = useState("");
  const [name, setName] = useState(world.display_name);
  const [password, setPassword] = useState(world.admin_password);
  const [serverPassword, setServerPassword] = useState(world.server_password || "");
  const [extraArgs, setExtraArgs] = useState(world.extra_args || "");
  const [autostart, setAutostart] = useState(!!world.autostart);
  const [crashGuard, setCrashGuard] = useState(!!world.crash_guard);
  const [community, setCommunity] = useState(!!world.community_server);
  const [legacyPerf, setLegacyPerf] = useState(world.legacy_perf_flags !== 0);
  const [saving, setSaving] = useState(false);
  const [installDir, setInstallDir] = useState(world.install_dir || "");
  const [movingDir, setMovingDir] = useState(false);
  const [ports, setPorts] = useState({ game_port: world.game_port, query_port: world.query_port, rest_api_port: world.rest_api_port, rcon_port: world.rcon_port });
  const [savingPorts, setSavingPorts] = useState(false);
  const isElectron = typeof window !== "undefined" && window.desktop?.isElectron;
  const portsChanged = ["game_port", "query_port", "rest_api_port", "rcon_port"].some((k) => Number(ports[k]) !== Number(world[k]));

  const savePorts = async () => {
    if (running) return toast(t("admin.stopBeforePorts"), "error");
    setSavingPorts(true);
    try {
      await api(`/api/worlds/${world.world_id}`, { method: "PATCH", body: ports });
      toast(t("admin.portsUpdated"), "success");
      onChange();
    } catch (e) { toast(e.message, "error"); }
    finally { setSavingPorts(false); }
  };

  const pickDir = async () => {
    if (isElectron) { const p = await window.desktop.pickDirectory(); if (p) setInstallDir(p); }
    else toast(t("create.typePathToast"));
  };

  const changeInstallDir = async () => {
    const target = installDir.trim();
    if (!target || target === world.install_dir) return;
    if (running) return toast(t("admin.stopBeforeFolder"), "error");
    setMovingDir(true);
    try {
      await api(`/api/worlds/${world.world_id}`, { method: "PATCH", body: { install_dir: target } });
      toast(t("admin.installFolderUpdated"), "success");
      onChange();
    } catch (e) { toast(e.message, "error"); }
    finally { setMovingDir(false); }
  };

  const broadcast = async () => {
    if (!announce.trim()) return;
    try {
      await api(`/api/worlds/${world.world_id}/rest`, { method: "POST", body: { command: "announce", message: announce.trim() } });
      toast(t("admin.broadcastSent"), "success");
      setAnnounce("");
    } catch (e) { toast(e.message, "error"); }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api(`/api/worlds/${world.world_id}`, {
        method: "PATCH",
        body: { display_name: name, admin_password: password, server_password: serverPassword, extra_args: extraArgs, autostart: autostart ? 1 : 0, crash_guard: crashGuard ? 1 : 0, community_server: community ? 1 : 0, legacy_perf_flags: legacyPerf ? 1 : 0 },
      });
      toast(t("admin.profileSaved"), "success");
      onChange();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: "grid", gap: "1.6rem" }}>
      <section>
        <h3 className="heading" style={{ fontSize: "1rem", marginTop: 0 }}>{t("admin.broadcastTitle")}</h3>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input className="input" placeholder={t("admin.announcePlaceholder")} value={announce} onChange={(e) => setAnnounce(e.target.value)} disabled={!running} />
          <button className="btn btn-primary" onClick={broadcast} disabled={!running}><Icon name="bell" /> {t("common.send")}</button>
        </div>
        {!running && <p className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", marginTop: 4 }}>{t("admin.broadcastHint")}</p>}
      </section>

      <section>
        <h3 className="heading" style={{ fontSize: "1rem" }}>{t("admin.worldProfile")}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
          <div>
            <label className="label">{t("admin.displayName")}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">{t("admin.adminPasswordRest")}</label>
            <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="label">{t("admin.serverPassword")}</label>
            <input className="input" value={serverPassword} onChange={(e) => setServerPassword(e.target.value)} placeholder={t("admin.serverPasswordPlaceholder")} />
            <p className="subtle" style={{ fontWeight: 600, fontSize: "0.74rem", marginTop: 4 }}>
              <Trans i18nKey="admin.serverPasswordHint" components={{ code: <code /> }} />
            </p>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="label">{t("admin.extraArgs")}</label>
            <input className="input" value={extraArgs} onChange={(e) => setExtraArgs(e.target.value)} placeholder="-e.g. -NoAsyncLoadingThread" />
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.8rem", marginTop: "0.9rem", flexWrap: "wrap" }}>
          <Toggle label={t("admin.autostart")} on={autostart} onClick={() => setAutostart((v) => !v)} />
          <Toggle label={t("admin.crashGuard")} on={crashGuard} onClick={() => setCrashGuard((v) => !v)} />
        </div>

        <div className="panel-inset" style={{ padding: "0.9rem 1.1rem", marginTop: "0.9rem", borderLeft: `3px solid ${community ? "var(--green-bright)" : "var(--line-strong)"}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ minWidth: 240, flex: 1 }}>
              <div className="heading" style={{ fontSize: "0.92rem" }}>{t("admin.communityTitle")}</div>
              <div className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", marginTop: 2 }}>
                <Trans i18nKey="admin.communityDesc" components={{ b: <b />, code: <code /> }} />
              </div>
            </div>
            <Toggle label={community ? t("admin.public") : t("admin.private")} on={community} onClick={() => setCommunity((v) => !v)} />
          </div>
          <div className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem", marginTop: 8 }}>
            {t("admin.communityNote")}
          </div>
        </div>

        <div className="panel-inset" style={{ padding: "0.9rem 1.1rem", marginTop: "0.9rem", borderLeft: `3px solid ${legacyPerf ? "var(--green-bright)" : "var(--line-strong)"}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ minWidth: 240, flex: 1 }}>
              <div className="heading" style={{ fontSize: "0.92rem" }}>{t("admin.legacyPerfTitle")}</div>
              <div className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", marginTop: 2 }}>
                <Trans i18nKey="admin.legacyPerfDesc" components={{ code: <code /> }} />
              </div>
            </div>
            <Toggle label={legacyPerf ? t("common.on") : t("common.off")} on={legacyPerf} onClick={() => setLegacyPerf((v) => !v)} />
          </div>
          <div className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem", marginTop: 8 }}>
            {t("admin.legacyPerfNote")}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
          <button className="btn btn-primary" onClick={saveProfile} disabled={saving}><Icon name="download" /> {saving ? t("common.saving") : t("admin.saveProfile")}</button>
        </div>
        {world.crash_count > 0 && (
          <p className="subtle" style={{ fontWeight: 700, fontSize: "0.76rem", marginTop: "0.6rem" }}>
            {t("admin.crashRestarted", { count: world.crash_count })}
          </p>
        )}
      </section>

      <section>
        <h3 className="heading" style={{ fontSize: "1rem" }}>{t("admin.installFolder")}</h3>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.8rem", marginTop: 0, marginBottom: "0.6rem" }}>
          <Trans i18nKey="admin.installFolderDesc" components={{ code: <code /> }} />
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input className="input" value={installDir} onChange={(e) => setInstallDir(e.target.value)}
            disabled={running || movingDir}
            placeholder={isElectron ? t("create.browseFolderPlaceholder") : "e.g. D:\\SteamLibrary\\steamapps\\common\\PalServer"} />
          <button className="btn btn-ghost" onClick={pickDir} disabled={running || movingDir}><Icon name="folder" /> {t("common.browse")}</button>
          <button className="btn btn-primary" onClick={changeInstallDir}
            disabled={running || movingDir || !installDir.trim() || installDir.trim() === world.install_dir}>
            {movingDir ? t("common.checking") : t("common.change")}
          </button>
        </div>
        {running && <p className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", marginTop: 4 }}>{t("admin.stopToChangeFolder")}</p>}
      </section>

      <section>
        <h3 className="heading" style={{ fontSize: "1rem" }}>{t("admin.connection")}</h3>
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: "0.6rem" }}>
          <PortField label={t("admin.portGameUdp")} value={ports.game_port} disabled={running} onChange={(v) => setPorts((p) => ({ ...p, game_port: v }))} />
          <PortField label={t("admin.portQuery")} value={ports.query_port} disabled={running} onChange={(v) => setPorts((p) => ({ ...p, query_port: v }))} />
          <PortField label={t("admin.portRest")} value={ports.rest_api_port} disabled={running} onChange={(v) => setPorts((p) => ({ ...p, rest_api_port: v }))} />
          <PortField label={t("admin.portRcon")} value={ports.rcon_port} disabled={running || !world.rcon_enabled} onChange={(v) => setPorts((p) => ({ ...p, rcon_port: v }))} />
        </div>
        <p className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", marginTop: "0.5rem" }}>
          {t("admin.portsHint")}
          {running ? t("admin.portsHintStop") : t("admin.portsHintNext")}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.6rem" }}>
          <button className="btn btn-primary" onClick={savePorts} disabled={running || savingPorts || !portsChanged}>
            {savingPorts ? t("common.saving") : t("admin.savePorts")}
          </button>
        </div>
      </section>
    </div>
  );
}

function PortField({ label, value, onChange, disabled }) {
  return (
    <div>
      <label className="label" style={{ fontSize: "0.7rem" }}>{label}</label>
      <input className="input" type="number" value={value} disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value || "0", 10))} />
    </div>
  );
}

function Toggle({ label, on, onClick }) {
  return (
    <button className={`btn ${on ? "btn-primary" : "btn-ghost"}`} onClick={onClick}>
      <span className="statdot" style={{ background: on ? "var(--accent-ink)" : "var(--ink-soft)" }} /> {label}
    </button>
  );
}
