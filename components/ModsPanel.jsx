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
  // Workshop update state, keyed by mod folder. null = never checked (we don't claim
  // anything about a mod until the user asks us to look).
  const [updates, setUpdates] = useState(null);
  const [checking, setChecking] = useState(false);
  // The mod awaiting a force-enable confirmation, if any.
  const [forcing, setForcing] = useState(null);
  const isElectron = typeof window !== "undefined" && window.desktop?.isElectron;

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

  const toggleMod = async (packageName, enabled, force = false) => {
    setBusy(true);
    try { setData(await api(`/api/worlds/${worldId}/mods/toggle`, { method: "POST", body: { packageName, enabled, force } })); }
    catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  // Enabling a mod that never declared IsServer is a deliberate override, so make the
  // user say so once — then it behaves like any other enable.
  const onEnableClick = (m) => {
    if (m.enabled || m.isServer) return toggleMod(m.packageName, !m.enabled);
    setForcing(m);
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

  // Compare every installed mod's Info.json Version against Steam's copy of the same
  // Workshop item. Read-only — nothing is copied until the user hits Update.
  const checkForUpdates = async () => {
    setChecking(true);
    try {
      const r = await api(`/api/worlds/${worldId}/mods/updates`);
      const byFolder = {};
      for (const u of r.updates) byFolder[u.folder] = u;
      setUpdates(byFolder);
      const n = r.updates.filter((u) => u.updateAvailable).length;
      toast(n ? t("mods.updatesFound", { count: n }) : t("mods.updatesNone"), n ? "success" : "info");
    } catch (e) { toast(e.message, "error"); } finally { setChecking(false); }
  };

  const updateMod = async (folder) => {
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/mods/updates`, { method: "POST", body: { folder } });
      setData(r);
      const res = r.results[0] || {};
      toast(t("mods.modUpdated", { name: res.packageName || folder, from: res.from || "?", to: res.to || "?" }), "success");
      setUpdates((u) => ({ ...u, [folder]: { ...(u?.[folder] || {}), updateAvailable: false, installedVersion: res.to } }));
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const updateAllMods = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/mods/updates`, { method: "POST", body: {} });
      setData(r);
      const ok = r.results.filter((x) => x.ok !== false).length;
      const failed = r.results.filter((x) => x.ok === false);
      // Report the partial result honestly rather than a blanket success.
      if (failed.length) toast(t("mods.updateAllPartial", { ok, failed: failed.length, error: failed[0].error }), "error");
      else toast(t("mods.updateAllDone", { count: ok }), "success");
      checkForUpdates();
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const openFolder = async (p) => {
    if (!isElectron) return toast(t("mods.openFolderDesktop"));
    try { await window.desktop.openPath(p); }
    catch (e) { toast(e.message, "error"); }
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

  const pendingCount = updates ? Object.values(updates).filter((u) => u.updateAvailable).length : 0;

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

      {/* Workshop update check + a shortcut to the Mods folder on disk. Steam refreshes
          its own copy of a subscribed item, but this world runs PSM's copy — so the two
          drift apart until we re-copy. */}
      {data.mods.length > 0 && (
        <div className="panel-inset" style={{ padding: "0.8rem 0.95rem", marginBottom: "1.2rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ minWidth: 200, flex: 1 }}>
            <div className="heading" style={{ fontSize: "0.9rem" }}>{t("mods.updatesTitle")}</div>
            <div className="subtle" style={{ fontSize: "0.76rem", fontWeight: 600 }}>
              {!updates ? t("mods.updatesNeverChecked")
                : pendingCount ? t("mods.updatesPending", { count: pendingCount })
                  : t("mods.updatesAllCurrent")}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            <button className="btn btn-ghost" disabled={busy || checking} onClick={checkForUpdates}>
              <Icon name="refresh" size={14} /> {checking ? t("common.checking") : t("mods.checkUpdates")}
            </button>
            {pendingCount > 0 && (
              <button className="btn btn-amber" disabled={busy || running} onClick={updateAllMods}>
                <Icon name="download" size={14} /> {t("mods.updateAll", { count: pendingCount })}
              </button>
            )}
            <button className="btn btn-ghost" disabled={busy} onClick={() => openFolder(data.workshopDir)} title={data.workshopDir}>
              <Icon name="folder" size={14} /> {t("mods.openModsFolder")}
            </button>
          </div>
        </div>
      )}

      {showWsHelp && <WorkshopHelpModal onClose={() => setShowWsHelp(false)} />}
      {forcing && (
        <ForceEnableModal
          mod={forcing}
          onClose={() => setForcing(null)}
          onConfirm={() => { const m = forcing; setForcing(null); toggleMod(m.packageName, true, true); }}
        />
      )}

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
            <ModRow
              key={m.folder} m={m} worldId={worldId} update={updates?.[m.folder]}
              busy={busy} running={running}
              onToggle={() => onEnableClick(m)}
              onUpdate={() => updateMod(m.folder)}
              onOpenFolder={() => openFolder(m.dir)}
              onRemove={() => removeMod(m.packageName || m.folder)}
            />
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

function ModRow({ m, worldId, update, busy, running, onToggle, onUpdate, onOpenFolder, onRemove }) {
  const { t } = useTranslation();
  // Mods ship their own preview art; fall back to the shield if the file is missing
  // or unreadable. Keyed by version so a freshly updated mod re-fetches its art.
  const [artOk, setArtOk] = useState(true);
  const src = `/api/worlds/${worldId}/mods/thumbnail?folder=${encodeURIComponent(m.folder)}&v=${encodeURIComponent(m.version || "")}`;
  const pending = !!update?.updateAvailable;

  return (
    <div className="panel-inset" style={{ padding: "0.7rem 0.9rem", display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap", borderLeft: pending ? "3px solid var(--yellow)" : undefined }}>
      <div style={{ width: 36, height: 36, borderRadius: 6, background: "var(--card-2)", display: "grid", placeItems: "center", flexShrink: 0, overflow: "hidden" }}>
        {m.hasThumbnail && artOk
          ? <img src={src} alt="" onError={() => setArtOk(false)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <Icon name="shield" size={18} />}
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {m.displayName}
          {m.version && <span className="subtle" style={{ fontSize: "0.72rem", fontWeight: 600 }}>v{m.version}</span>}
          {pending && (
            <span className="chip" style={{ background: "var(--yellow)", color: "#1e1f22" }}>
              {t("mods.updateChip", { version: update.availableVersion })}
            </span>
          )}
          {!m.isServer && <span className="chip" style={{ background: "var(--yellow)", color: "#1e1f22" }} title={t("mods.notServerModTip")}>{t("mods.notServerMod")}</span>}
          {m.infoError && <span className="chip" style={{ background: "var(--red)", color: "#fff" }}>{t("mods.badInfoJson")}</span>}
        </div>
        <div className="subtle" style={{ fontSize: "0.72rem", fontWeight: 600, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span>{m.packageName || m.folder}</span>
          {/* The folder name is the Workshop id for mods added by id — showing it here
              is how you find the mod on disk (and on the Workshop) without digging. */}
          {m.workshopId && <span title={t("mods.workshopIdTip")}>· {m.workshopId}</span>}
        </div>
      </div>

      {pending && (
        <button className="btn btn-amber" style={{ padding: "0.35rem 0.7rem" }} disabled={busy || running} onClick={onUpdate}>
          <Icon name="download" size={14} /> {t("mods.updateBtn")}
        </button>
      )}
      <button className={`btn ${m.enabled ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.35rem 0.7rem" }}
        disabled={busy || running || !m.packageName}
        title={!m.isServer && !m.enabled ? t("mods.forceEnableTip") : undefined}
        onClick={onToggle}>
        {m.enabled ? t("mods.enabledBtn") : t("mods.disabledBtn")}
      </button>
      <button className="btn btn-ghost" style={{ padding: "0.35rem 0.6rem" }} disabled={busy} onClick={onOpenFolder}
        title={t("mods.openFolderTip", { dir: m.dir })} aria-label={t("mods.openFolderTip", { dir: m.dir })}>
        <Icon name="folder" size={14} />
      </button>
      <button className="btn btn-danger" style={{ padding: "0.35rem 0.6rem" }} disabled={busy || running} onClick={onRemove}>
        <Icon name="trash" size={14} />
      </button>
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

// Confirmation for enabling a mod whose Info.json never opted into dedicated servers.
// Plenty of them run fine — the author just didn't write server install rules — but
// Palworld's own deploy skips them, so what happens next depends on the mod's type:
// a Lua mod we can bridge into UE4SS ourselves; a Pak-only one we can't.
function ForceEnableModal({ mod, onClose, onConfirm }) {
  const { t } = useTranslation();
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel animate-floatUp" style={{ width: 500, maxWidth: "94vw", padding: "1.4rem 1.5rem" }}>
        <div className="heading" style={{ fontSize: "1.05rem", marginBottom: "0.8rem", display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="shield" size={18} /> {t("mods.forceTitle", { name: mod.displayName })}
        </div>
        <p style={{ fontSize: "0.86rem", fontWeight: 600, lineHeight: 1.5, marginTop: 0 }}>
          <Trans i18nKey="mods.forceIntro" components={{ b: <b />, code: <code /> }} />
        </p>
        <div className="panel-inset" style={{ padding: "0.7rem 0.9rem", borderLeft: `3px solid ${mod.hasLua ? "var(--accent)" : "var(--yellow)"}`, fontSize: "0.82rem", fontWeight: 600, lineHeight: 1.5 }}>
          {mod.hasLua
            ? <Trans i18nKey="mods.forceLua" components={{ b: <b /> }} />
            : <Trans i18nKey="mods.forcePakOnly" components={{ b: <b /> }} />}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.1rem" }}>
          <button className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-amber" onClick={onConfirm}>{t("mods.forceConfirm")}</button>
        </div>
      </div>
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
