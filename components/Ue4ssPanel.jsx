"use client";
import { useEffect, useState, useCallback } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";

export default function Ue4ssPanel({ worldId, running }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const isElectron = typeof window !== "undefined" && window.desktop?.isElectron;

  const load = useCallback(async () => {
    try { setData(await api(`/api/worlds/${worldId}/ue4ss`)); }
    catch (e) { toast(e.message, "error"); }
  }, [worldId]);

  useEffect(() => { load(); }, [load]);

  const installUe4ss = async () => {
    if (!isElectron) return toast(t("common.pickerDesktop"));
    if (running) return toast(t("ue4ss.stopBeforeInstall"), "error");
    const zipPath = await window.desktop.pickZip();
    if (!zipPath) return;
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/ue4ss`, { method: "POST", body: { zipPath } });
      toast(r.installed ? t("ue4ss.installedRestart") : t("ue4ss.installedNotDetected"), r.installed ? "success" : "error");
      load();
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const fixGui = async () => {
    setBusy(true);
    try { setData(await api(`/api/worlds/${worldId}/ue4ss`, { method: "PATCH" })); toast(t("ue4ss.consoleDisabled"), "success"); }
    catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const importMod = async () => {
    if (!isElectron) return toast(t("common.pickerDesktop"));
    const zipPath = await window.desktop.pickZip();
    if (!zipPath) return;
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/ue4ss/mods`, { method: "POST", body: { action: "import", zipPath } });
      toast(t("ue4ss.imported", { name: r.result.name }), "success");
      setData((d) => ({ ...d, mods: r.mods }));
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const toggleMod = async (name, enabled) => {
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/ue4ss/mods`, { method: "POST", body: { action: "toggle", name, enabled } });
      setData((d) => ({ ...d, mods: r.mods }));
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const removeMod = async (name) => {
    if (!confirm(t("ue4ss.confirmRemove", { name }))) return;
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/ue4ss/mods`, { method: "POST", body: { action: "remove", name } });
      setData((d) => ({ ...d, mods: r.mods }));
      toast(t("ue4ss.removed"), "success");
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  if (!data) return <p className="subtle" style={{ fontWeight: 600 }}>{t("ue4ss.loading")}</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", margin: 0 }}>{t("ue4ss.title")}</h3>
        {data.installed
          ? <span className="chip" style={{ background: "var(--green-bright)", color: "#0c1a0c" }}>{t("ue4ss.installed")}</span>
          : <span className="chip" style={{ background: "var(--line-strong)" }}>{t("ue4ss.notInstalled")}</span>}
      </div>
      <p className="subtle" style={{ fontWeight: 600, fontSize: "0.8rem", marginTop: 0 }}>
        <Trans i18nKey="ue4ss.desc" components={{ code: <code /> }} />
      </p>

      {!data.installed && (
        <div className="panel-inset" style={{ padding: "0.9rem 1.1rem", borderLeft: "3px solid var(--yellow)", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>{t("ue4ss.notInstalledTitle")}</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 8px" }}>
            <Trans i18nKey="ue4ss.notInstalledDesc" components={{ code: <code /> }} />
          </p>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 10px" }}>
            {t("ue4ss.getUe4ssLabel")}{" "}
            <a href="https://pwmodding.wiki/docs/users/ue4ss/installation-server" target="_blank" rel="noreferrer"
              style={{ color: "var(--accent)", fontWeight: 700 }}>{t("ue4ss.installGuide")}</a>
            {" · "}
            <a href="https://github.com/UE4SS-RE/RE-UE4SS/releases" target="_blank" rel="noreferrer"
              style={{ color: "var(--accent)", fontWeight: 700 }}>{t("ue4ss.releases")}</a>
          </p>
          <button className="btn btn-primary" style={{ padding: "0.4rem 0.8rem" }} disabled={busy || running} onClick={installUe4ss}>
            <Icon name="upload" size={15} /> {t("ue4ss.installBtn")}
          </button>
          {running && <span className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", marginLeft: 8 }}>{t("ue4ss.stopFirst")}</span>}
        </div>
      )}

      {data.installed && data.guiConsoleVisible === true && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--red)", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 800, fontSize: "0.86rem", marginBottom: 4 }}>{t("ue4ss.consoleEnabledTitle")}</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 8px" }}>
            <Trans i18nKey="ue4ss.consoleEnabledDesc" components={{ code: <code /> }} />
          </p>
          <button className="btn btn-primary" style={{ padding: "0.35rem 0.7rem" }} disabled={busy} onClick={fixGui}>{t("ue4ss.disableConsole")}</button>
        </div>
      )}

      {data.installed && running && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--red)", marginBottom: "1rem" }}>
          <span style={{ fontWeight: 700, fontSize: "0.82rem" }}>{t("ue4ss.stopToManage")}</span>
          <span className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem" }}>{t("ue4ss.loadsAtBoot")}</span>
        </div>
      )}

      {data.installed && (
        <>
          <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={busy || running} onClick={importMod}><Icon name="upload" /> {t("ue4ss.importLua")}</button>
          </div>

          {data.mods.length === 0 ? (
            <div className="panel-inset" style={{ padding: "1.4rem", textAlign: "center" }}>
              <div className="subtle" style={{ fontWeight: 600 }}><Trans i18nKey="ue4ss.emptyMods" components={{ code: <code /> }} /></div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {data.mods.map((m) => (
                <div key={m.name} className="panel-inset" style={{ padding: "0.7rem 0.9rem", display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 6, background: "var(--card-2)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Icon name="terminal" size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8 }}>
                      {m.name}
                      {!m.hasLua && <span className="chip" style={{ background: "var(--yellow)", color: "#1e1f22" }}>{t("ue4ss.noMainLua")}</span>}
                      {m.forcedByEnabledTxt && <span className="chip" style={{ background: "var(--card-2)" }}>{t("ue4ss.enabledTxt")}</span>}
                    </div>
                  </div>
                  <button className={`btn ${m.enabled ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.35rem 0.7rem" }}
                    disabled={busy || running} onClick={() => toggleMod(m.name, !m.enabled)}>
                    {m.enabled ? t("ue4ss.enabledBtn") : t("ue4ss.disabledBtn")}
                  </button>
                  <button className="btn btn-danger" style={{ padding: "0.35rem 0.6rem" }} disabled={busy || running} onClick={() => removeMod(m.name)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.74rem", marginTop: "0.8rem" }}>
            <Trans i18nKey="ue4ss.restartNote" components={{ b: <b /> }} />
          </p>
        </>
      )}
    </div>
  );
}
