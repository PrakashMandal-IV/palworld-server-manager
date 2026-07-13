"use client";
import { useEffect, useState, useCallback } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";

export default function ModsPanel({ worldId, running }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wsId, setWsId] = useState("");
  const [showWsHelp, setShowWsHelp] = useState(false);
  const isElectron = typeof window !== "undefined" && window.desktop?.isElectron;
  const isWindows = typeof navigator !== "undefined" && /Win/.test(navigator.platform);

  const load = useCallback(async () => {
    try { setData(await api(`/api/worlds/${worldId}/mods`)); }
    catch (e) { toast(e.message, "error"); }
  }, [worldId]);

  useEffect(() => { load(); }, [load]);

  const toggleGlobal = async (on) => {
    setBusy(true);
    try { setData(await api(`/api/worlds/${worldId}/mods/toggle`, { method: "POST", body: { global: on } })); toast(on ? t("mods.toggledOn") : t("mods.toggledOff"), "success"); }
    catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const toggleMod = async (packageName, enabled) => {
    setBusy(true);
    try { setData(await api(`/api/worlds/${worldId}/mods/toggle`, { method: "POST", body: { packageName, enabled } })); }
    catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const importZip = async () => {
    if (!isElectron) return toast(t("common.pickerDesktop"));
    const zipPath = await window.desktop.pickZip();
    if (!zipPath) return;
    setBusy(true);
    try {
      const { result } = await api(`/api/worlds/${worldId}/mods/import`, { method: "POST", body: { zipPath } });
      toast(result.isServer ? t("mods.imported", { name: result.packageName }) : t("mods.importedNotServer", { name: result.packageName }), result.isServer ? "success" : "error");
      load();
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const addWorkshop = async () => {
    if (!wsId.trim()) return;
    setBusy(true);
    try {
      const { result } = await api(`/api/worlds/${worldId}/mods/import`, { method: "POST", body: { workshopId: wsId.trim() } });
      toast(t("mods.addedWorkshop", { name: result.packageName || wsId }), "success");
      setWsId(""); load();
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  // Point PSM at the Steam library where Workshop content lives (for setups where
  // Steam isn't on C:). Saved machine-wide, so every future add finds mods on its own.
  const setSteamLibrary = async (path) => {
    setBusy(true);
    try {
      setData(await api(`/api/worlds/${worldId}/mods/steam-library`, { method: "POST", body: { path: path || null } }));
      toast(path ? t("mods.steamLibrarySaved") : t("mods.steamLibraryReset"), "success");
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const pickSteamLibrary = async () => {
    if (!isElectron) return toast(t("common.folderPickerDesktop"));
    const dir = await window.desktop.pickDirectory();
    if (dir) setSteamLibrary(dir);
  };

  const removeMod = async (pkg) => {
    if (!confirm(t("mods.confirmRemove", { pkg }))) return;
    setBusy(true);
    try { setData(await api(`/api/worlds/${worldId}/mods?pkg=${encodeURIComponent(pkg)}`, { method: "DELETE" })); toast(t("mods.removed"), "success"); }
    catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  if (!data) return <p className="subtle" style={{ fontWeight: 600 }}>{t("mods.loading")}</p>;

  return (
    <div>
      {/* platform + restart notices */}
      {data.windowsOnlyWarning && (
        <Notice color="var(--yellow)">
          <Trans i18nKey="mods.windowsOnly" components={{ b: <b /> }} />
        </Notice>
      )}
      {running ? (
        <Notice color="var(--red)">
          <Trans i18nKey="mods.runningNotice" components={{ b: <b /> }} />
        </Notice>
      ) : (
        <Notice color="var(--accent)">
          <Trans i18nKey="mods.bootNotice" components={{ b: <b /> }} />
        </Notice>
      )}

      {/* global switch + import controls */}
      <div className="panel-inset" style={{ padding: "0.9rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div>
          <div className="heading" style={{ fontSize: "0.95rem" }}>{t("mods.globalTitle")}</div>
          <div className="subtle" style={{ fontSize: "0.78rem", fontWeight: 600 }}>
            {data.globalEnable ? t("mods.globalEnabled") : t("mods.globalDisabled")}
          </div>
        </div>
        <button className={`btn ${data.globalEnable ? "btn-primary" : "btn-ghost"}`} disabled={busy || running} onClick={() => toggleGlobal(!data.globalEnable)}>
          {data.globalEnable ? t("common.on") : t("common.off")}
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1.2rem", flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={busy || running} onClick={importZip}><Icon name="upload" /> {t("mods.importZip")}</button>
        <div style={{ display: "flex", gap: "0.4rem", flex: 1, minWidth: 240, alignItems: "center" }}>
          <input className="input" placeholder={t("mods.workshopPlaceholder")} value={wsId} onChange={(e) => setWsId(e.target.value)} disabled={running} />
          <button className="btn btn-subtle" disabled={busy || running} onClick={addWorkshop}>{t("mods.add")}</button>
          <button className="btn btn-ghost" style={{ padding: "0.4rem 0.5rem" }} title={t("mods.workshopHelpAria")} aria-label={t("mods.workshopHelpAria")} onClick={() => setShowWsHelp(true)}>
            <Icon name="info" size={16} />
          </button>
        </div>
      </div>

      {showWsHelp && <WorkshopHelpModal onClose={() => setShowWsHelp(false)} />}

      {/* Steam library location — where subscribed Workshop content is found. Auto-detected
          across drives; overridable for setups where Steam isn't on C:. */}
      <div className="panel-inset" style={{ padding: "0.8rem 0.95rem", marginBottom: "1.2rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ minWidth: 200, flex: 1 }}>
            <div className="heading" style={{ fontSize: "0.9rem" }}>{t("mods.steamLibraryTitle")}</div>
            <div className="subtle" style={{ fontSize: "0.76rem", fontWeight: 600, wordBreak: "break-all" }}>
              {data.steamLibraryPath
                ? <Trans i18nKey="mods.usingSavedFolder" values={{ path: data.steamLibraryPath }} components={{ code: <code /> }} />
                : data.steamLibrariesDetected?.length
                  ? t("mods.autoDetected", { count: data.steamLibrariesDetected.length })
                  : t("mods.noSteamDetected")}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button className="btn btn-ghost" disabled={busy} onClick={pickSteamLibrary}><Icon name="folder" size={14} /> {data.steamLibraryPath ? t("mods.change") : t("mods.setFolder")}</button>
            {data.steamLibraryPath && <button className="btn btn-subtle" disabled={busy} onClick={() => setSteamLibrary(null)}>{t("common.reset")}</button>}
          </div>
        </div>
        {data.steamLibrariesDetected?.length > 0 && (
          <details style={{ marginTop: "0.5rem" }}>
            <summary className="subtle" style={{ fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>{t("mods.detectedLibraries")}</summary>
            <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
              {data.steamLibrariesDetected.map((p) => (
                <li key={p} className="subtle" style={{ fontSize: "0.72rem", fontWeight: 600, wordBreak: "break-all" }}><code>{p}</code></li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* installed mods list */}
      {data.mods.length === 0 ? (
        <div className="panel-inset" style={{ padding: "2rem", textAlign: "center" }}>
          <div className="subtle" style={{ fontWeight: 600 }}>
            {t("mods.empty")}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {data.mods.map((m) => (
            <div key={m.folder} className="panel-inset" style={{ padding: "0.7rem 0.9rem", display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
              <div style={{ width: 36, height: 36, borderRadius: 6, background: "var(--card-2)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Icon name="shield" size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8 }}>
                  {m.displayName}
                  {m.version && <span className="subtle" style={{ fontSize: "0.72rem", fontWeight: 600 }}>v{m.version}</span>}
                  {!m.isServer && <span className="chip" style={{ background: "var(--yellow)", color: "#1e1f22" }}>{t("mods.notServerMod")}</span>}
                  {m.infoError && <span className="chip" style={{ background: "var(--red)", color: "#fff" }}>{t("mods.badInfoJson")}</span>}
                </div>
                <div className="subtle" style={{ fontSize: "0.72rem", fontWeight: 600 }}>{m.packageName || m.folder}</div>
              </div>
              <button className={`btn ${m.enabled ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.35rem 0.7rem" }}
                disabled={busy || running || !m.packageName || !m.isServer} onClick={() => toggleMod(m.packageName, !m.enabled)}>
                {m.enabled ? t("mods.enabledBtn") : t("mods.disabledBtn")}
              </button>
              <button className="btn btn-danger" style={{ padding: "0.35rem 0.6rem" }} disabled={busy || running} onClick={() => removeMod(m.packageName || m.folder)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {data.dangling?.length > 0 && (
        <Notice color="var(--yellow)">
          {t("mods.danglingNotice", { list: data.dangling.join(", ") })}
        </Notice>
      )}
    </div>
  );
}

function Notice({ color, children }) {
  return (
    <div className="panel-inset" style={{ padding: "0.7rem 0.9rem", borderLeft: `3px solid ${color}`, marginBottom: "1rem", fontWeight: 600, fontSize: "0.84rem" }}>
      {children}
    </div>
  );
}

// How-to for the Workshop ID field: getting an item's numeric id, and the fact that
// PSM can only add mods Steam has already downloaded (subscribe first) — otherwise
// use the .zip import instead.
function WorkshopHelpModal({ onClose }) {
  const { t } = useTranslation();
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel animate-floatUp" style={{ width: 520, maxWidth: "94vw", maxHeight: "90vh", overflow: "auto", padding: "1.4rem 1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.9rem" }}>
          <div className="heading" style={{ fontSize: "1.05rem", display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="info" size={18} /> {t("mods.wsModalTitle")}
          </div>
          <button className="btn btn-ghost" style={{ padding: "0.35rem 0.5rem" }} onClick={onClose} aria-label={t("common.dismiss")}><Icon name="x" size={16} /></button>
        </div>

        <p style={{ fontSize: "0.86rem", fontWeight: 600, marginBottom: "0.9rem", lineHeight: 1.5 }}>
          <Trans i18nKey="mods.wsModalIntro" components={{ b: <b /> }} />
        </p>

        <ol style={{ margin: "0 0 1rem", paddingLeft: "1.2rem", display: "grid", gap: "0.55rem", fontSize: "0.84rem", fontWeight: 600, lineHeight: 1.5 }}>
          <li><Trans i18nKey="mods.wsStep1" components={{ b: <b /> }} /></li>
          <li><Trans i18nKey="mods.wsStep2" components={{ b: <b />, code: <code style={{ wordBreak: "break-all" }} /> }} /></li>
          <li><Trans i18nKey="mods.wsStep3" components={{ b: <b /> }} /></li>
        </ol>

        <div className="panel-inset" style={{ padding: "0.7rem 0.9rem", borderLeft: "3px solid var(--accent)", fontSize: "0.82rem", fontWeight: 600, lineHeight: 1.5 }}>
          <Trans i18nKey="mods.wsModalNote" components={{ b: <b />, code: <code /> }} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.1rem" }}>
          <button className="btn btn-primary" onClick={onClose}>{t("mods.gotIt")}</button>
        </div>
      </div>
    </div>
  );
}
