"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation, Trans } from "react-i18next";
import { useTheme } from "@/components/ThemeProvider";
import { switchLanguage } from "@/lib/i18n/client";
import { api, Icon, toast } from "@/components/ui";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const [s, setS] = useState(null);
  const [steam, setSteam] = useState(null);
  const [saving, setSaving] = useState(false);
  const [backupLoc, setBackupLoc] = useState(null);
  const [backupPath, setBackupPath] = useState("");
  const [langs, setLangs] = useState([]);
  const [switching, setSwitching] = useState(false);
  const [catalog, setCatalog] = useState(null); // null=loading, {checked,packs}=loaded
  const [busyCode, setBusyCode] = useState(""); // code currently installing/updating/deleting
  const [autoLaunch, setAutoLaunchState] = useState(null);
  const isElectron = typeof window !== "undefined" && window.desktop?.isElectron;

  useEffect(() => {
    api("/api/settings").then((r) => setS(r.settings)).catch(() => {});
    api("/api/steamcmd").then(setSteam).catch(() => {});
    api("/api/settings/backup-dir").then((r) => { setBackupLoc(r.backup); setBackupPath(r.backup.custom ? r.backup.path : ""); }).catch(() => {});
    api("/api/i18n/languages").then((r) => setLangs(r.languages || [])).catch(() => {});
    loadCatalog();
    if (isElectron) window.desktop.getAutoLaunch().then(setAutoLaunchState).catch(() => setAutoLaunchState(true));
  }, []);

  const loadCatalog = (force) =>
    api(`/api/i18n/registry${force ? "?force=1" : ""}`)
      .then((r) => setCatalog({ checked: !!r.checked, packs: r.packs || [] }))
      .catch(() => setCatalog({ checked: false, packs: [] }));

  const chooseLanguage = async (code) => {
    if (code === i18n.language) return;
    setSwitching(true);
    try {
      const meta = langs.find((l) => l.code === code);
      await switchLanguage(code, meta?.dir || "ltr");
      setS((prev) => (prev ? { ...prev, language: code } : prev));
    } catch (e) { toast(e.message, "error"); }
    finally { setSwitching(false); }
  };

  const refreshLangs = () => api("/api/i18n/languages").then((r) => setLangs(r.languages || [])).catch(() => {});

  // Install (or update) a pack straight from the GitHub catalog. The download route
  // re-validates every pack exactly like a hand-imported file — the catalog only
  // supplies the (host-allowlisted) link. We don't auto-switch; it just becomes
  // available in the picker above.
  const installFromCatalog = async (entry) => {
    setBusyCode(entry.code);
    try {
      const r = await api("/api/i18n/download", { method: "POST", body: { url: entry.url, updatedAt: entry.updatedAt } });
      toast(t("language.imported", { name: r.language?.nativeName || entry.nativeName || entry.code }), "success");
      await refreshLangs();
      loadCatalog();
    } catch (err) { toast(err.message, "error"); }
    finally { setBusyCode(""); }
  };

  // Delete an installed pack — no need to leave the app.
  const deleteFromCatalog = async (entry) => {
    if (!confirm(t("language.confirmRemove", { name: entry.nativeName || entry.code }))) return;
    setBusyCode(entry.code);
    try {
      const r = await api(`/api/i18n/import?code=${encodeURIComponent(entry.code)}`, { method: "DELETE" });
      setLangs(r.languages || []);
      loadCatalog();
      toast(t("language.removed"), "success");
      // If the deleted pack was the active language, fall back to English.
      if (i18n.language === entry.code) { await switchLanguage("en", "ltr"); setS((prev) => (prev ? { ...prev, language: "en" } : prev)); }
    } catch (err) { toast(err.message, "error"); }
    finally { setBusyCode(""); }
  };

  const saveBackupDir = async (p) => {
    setSaving(true);
    try {
      const r = await api("/api/settings/backup-dir", { method: "POST", body: { path: p } });
      setBackupLoc(r.backup);
      setBackupPath(r.backup.custom ? r.backup.path : "");
      toast(r.backup.custom ? t("settings.backupLocationUpdated") : t("settings.backupLocationReset"), "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const pickBackupDir = async () => {
    if (!isElectron) return;
    const p = await window.desktop.pickDirectory();
    if (p) setBackupPath(p);
  };

  const toggleAutoLaunch = async () => {
    if (!isElectron || autoLaunch === null) return;
    const next = !autoLaunch;
    setAutoLaunchState(next);
    try { await window.desktop.setAutoLaunch(next); }
    catch (e) { setAutoLaunchState(!next); toast(e.message, "error"); }
  };

  const save = async (patch) => {
    setSaving(true);
    try {
      const r = await api("/api/settings", { method: "POST", body: patch });
      setS(r.settings);
      toast(t("settings.saved"), "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  if (!s) return <div className="subtle" style={{ fontWeight: 700 }}>{t("common.loading")}</div>;

  return (
    <div>
      <h1 className="heading" style={{ fontSize: "1.9rem", margin: "0 0 1.2rem" }}>{t("settings.title")}</h1>

      <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>{t("settings.appearance")}</h3>
        <label className="label">{t("settings.theme")}</label>
        <div style={{ display: "flex", gap: "0.6rem" }}>
          <button className={`btn ${theme === "light" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTheme("light")}><Icon name="sun" /> {t("settings.light")}</button>
          <button className={`btn ${theme === "dark" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTheme("dark")}><Icon name="moon" /> {t("settings.dark")}</button>
        </div>
      </div>

      <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>
          <Icon name="globe" size={17} /> {t("settings.language")}
        </h3>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 0.6rem" }}>{t("settings.languageHelp")}</p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", maxWidth: 360 }}>
          <select className="input" style={{ flex: 1, minWidth: 200 }} value={i18n.language} disabled={switching}
            onChange={(e) => chooseLanguage(e.target.value)}>
            {langs.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}{l.completeness < 100 ? ` — ${t("language.completeness", { percent: l.completeness })}` : ""}
              </option>
            ))}
          </select>
          {switching && <span className="subtle" style={{ fontSize: "0.78rem", fontWeight: 700 }}>…</span>}
        </div>
        {(() => {
          const cur = langs.find((l) => l.code === i18n.language);
          return cur && cur.completeness < 100 ? (
            <p className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem", margin: "0.5rem 0 0" }}>{t("settings.languagePartial")}</p>
          ) : null;
        })()}

        {/* Language packs from the GitHub catalog — install / update / delete, all in-app */}
        <div style={{ marginTop: "1.1rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <div className="heading" style={{ fontSize: "0.92rem" }}>{t("language.browseTitle")}</div>
            <Link href="/language-packs" className="btn btn-ghost" style={{ marginLeft: "auto", padding: "0.2rem 0.5rem", fontSize: "0.72rem" }}
              title={t("language.makeOwn")}>
              <Icon name="info" size={13} /> {t("language.makeOwn")}
            </Link>
            <button className="btn btn-ghost" style={{ padding: "0.2rem 0.5rem", fontSize: "0.72rem" }}
              onClick={() => loadCatalog(true)} disabled={catalog === null || !!busyCode}>
              <Icon name="refresh" size={13} /> {t("language.refresh")}
            </button>
          </div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.76rem", margin: "0.2rem 0 0.7rem" }}>{t("language.browseDesc")}</p>

          {catalog === null ? (
            <p className="subtle" style={{ fontWeight: 700, fontSize: "0.78rem" }}>{t("common.loading")}</p>
          ) : !catalog.checked ? (
            <div className="panel-inset" style={{ padding: "0.7rem 0.9rem", borderLeft: "3px solid var(--yellow)" }}>
              <p className="subtle" style={{ fontWeight: 600, fontSize: "0.76rem", margin: 0 }}>{t("language.catalogOffline")}</p>
            </div>
          ) : catalog.packs.length === 0 ? (
            <p className="subtle" style={{ fontWeight: 600, fontSize: "0.76rem" }}>{t("language.noPacks")}</p>
          ) : (
            <div style={{ display: "grid", gap: "0.4rem" }}>
              {catalog.packs.map((p) => {
                const busy = busyCode === p.code;
                const anyBusy = !!busyCode;
                return (
                  <div key={p.code} className="panel-inset" style={{ padding: "0.5rem 0.7rem", display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: "0.84rem" }}>
                        {p.nativeName} <span className="subtle" style={{ fontWeight: 700 }}>· {p.name}</span>
                        {p.installed && <span className="s-running" style={{ fontWeight: 800, fontSize: "0.72rem", marginLeft: "0.4rem", whiteSpace: "nowrap" }}>✓ {t("language.installed")}</span>}
                      </div>
                      <div className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem" }}>
                        {p.code}
                        {typeof p.completeness === "number" ? ` · ${t("language.completeness", { percent: p.completeness })}` : ""}
                        {p.authors?.length ? ` · ${t("language.byAuthors", { authors: p.authors.join(", ") })}` : ""}
                      </div>
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", gap: "0.35rem", alignItems: "center" }}>
                      {p.unsupported ? (
                        <span className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem" }}>{t("language.needsAppVersion", { version: p.appMinVersion })}</span>
                      ) : busy ? (
                        <button className="btn btn-ghost" disabled style={{ padding: "0.25rem 0.6rem", fontSize: "0.74rem" }}>{t("language.installing")}</button>
                      ) : (
                        <>
                          {p.updateAvailable && (
                            <button className="btn btn-primary" style={{ padding: "0.25rem 0.6rem", fontSize: "0.74rem" }}
                              onClick={() => installFromCatalog(p)} disabled={anyBusy}>
                              <Icon name="download" size={13} /> {t("language.update")}
                            </button>
                          )}
                          {p.installed ? (
                            <button className="btn btn-ghost" style={{ padding: "0.25rem 0.55rem", fontSize: "0.74rem" }}
                              onClick={() => deleteFromCatalog(p)} disabled={anyBusy}>
                              <Icon name="trash" size={13} /> {t("language.remove")}
                            </button>
                          ) : (
                            <button className="btn btn-primary" style={{ padding: "0.25rem 0.6rem", fontSize: "0.74rem" }}
                              onClick={() => installFromCatalog(p)} disabled={anyBusy}>
                              <Icon name="download" size={13} /> {t("language.install")}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>{t("settings.discordTitle")}</h3>
        <div className="panel-inset" style={{ padding: "0.9rem 1.1rem", borderLeft: "3px solid var(--yellow)" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>{t("settings.discordMoved")}</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.8rem", margin: 0 }}>
            <Trans i18nKey="settings.discordMovedDesc" components={{ b: <b /> }} />
          </p>
          <Link href="/" className="btn btn-primary" style={{ marginTop: "0.8rem", padding: "0.35rem 0.7rem" }}>
            <Icon name="globe" size={15} /> {t("settings.goToWorlds")}
          </Link>
        </div>
      </div>

      <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>{t("settings.chatCaptureTitle")}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <button className={`btn ${s.chatCaptureEnabled !== false ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.35rem 0.7rem" }}
            onClick={() => save({ chatCaptureEnabled: !(s.chatCaptureEnabled !== false) })} disabled={saving}>
            {s.chatCaptureEnabled !== false ? t("common.on") : t("common.off")}
          </button>
          <span className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem" }}>
            <Trans i18nKey="settings.chatCaptureDesc" components={{ b: <b /> }} />
          </span>
        </div>
      </div>

      {isElectron && (
        <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
          <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>{t("settings.autoLaunchTitle")}</h3>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <button className={`btn ${autoLaunch !== false ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.35rem 0.7rem" }}
              onClick={toggleAutoLaunch} disabled={autoLaunch === null}>
              {autoLaunch !== false ? t("common.on") : t("common.off")}
            </button>
            <span className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem" }}>{t("settings.autoLaunchDesc")}</span>
          </div>
        </div>
      )}

      <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>{t("settings.hideConsoleTitle")}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <button className={`btn ${s.hideConsoleWindow !== false ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.35rem 0.7rem" }}
            onClick={() => save({ hideConsoleWindow: s.hideConsoleWindow === false })} disabled={saving}>
            {s.hideConsoleWindow !== false ? t("common.on") : t("common.off")}
          </button>
          <span className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem" }}>
            <Trans i18nKey="settings.hideConsoleDesc" components={{ b: <b /> }} />
          </span>
        </div>
        {s.hideConsoleWindow === false && (
          <p className="subtle" style={{ fontSize: "0.78rem", marginBottom: 0, marginTop: "0.6rem" }}>
            <Trans i18nKey="settings.hideConsoleWarn" components={{ b: <b /> }} />
          </p>
        )}
      </div>

      <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>{t("settings.backupsTitle")}</h3>
        <label className="label">{t("settings.keepLastN")}</label>
        <div style={{ display: "flex", gap: "0.5rem", maxWidth: 260 }}>
          <input className="input" type="number" min="1" value={s.backupRetention ?? 10} onChange={(e) => setS({ ...s, backupRetention: Number(e.target.value) })} />
          <button className="btn btn-primary" onClick={() => save({ backupRetention: s.backupRetention })} disabled={saving}>{t("common.save")}</button>
        </div>

        {backupLoc && (
          <div style={{ marginTop: "1.1rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <label className="label">{t("settings.backupLocation")}</label>
            <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 0.5rem" }}>
              <Trans i18nKey="settings.backupLocationDesc"
                values={{ where: backupLoc.custom ? t("settings.customFolder") : t("settings.defaultFolder") }}
                components={{ b: <b />, w: <span style={{ fontWeight: 800 }} /> }} />
            </p>
            <p className="subtle" style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", margin: "0 0 0.6rem", wordBreak: "break-all" }}>{backupLoc.path}</p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder={t("settings.backupPathPlaceholder")}
                value={backupPath} onChange={(e) => setBackupPath(e.target.value)} />
              {isElectron && (
                <button className="btn btn-ghost" onClick={pickBackupDir} disabled={saving}><Icon name="folder" size={15} /> {t("settings.chooseFolder")}</button>
              )}
              <button className="btn btn-primary" onClick={() => saveBackupDir(backupPath)} disabled={saving}>{t("common.save")}</button>
              {backupLoc.custom && (
                <button className="btn btn-ghost" onClick={() => saveBackupDir("")} disabled={saving}>{t("common.reset")}</button>
              )}
            </div>
            <p className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem", margin: "0.5rem 0 0" }}>
              {t("settings.existingBackupsNote")}
            </p>
          </div>
        )}
      </div>

      <div className="panel" style={{ padding: "1.3rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>{t("settings.steamcmdTitle")}</h3>
        <p style={{ fontWeight: 700, fontSize: "0.86rem", margin: 0 }}>
          <span className={steam?.installed ? "s-running" : "s-crashed"}>
            {steam?.installed ? t("settings.steamcmdInstalled") : t("settings.steamcmdNotInstalled")}
          </span>
          <span className="subtle">{t("settings.steamcmdNote")}</span>
        </p>
        {steam?.path && <p className="subtle" style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", marginTop: 6 }}>{steam.path}</p>}
      </div>

      <div className="panel" style={{ padding: "1.3rem", marginTop: "1rem", borderLeft: "3px solid var(--line-strong)" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>{t("settings.devTitle")}</h3>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.8rem", marginTop: 0 }}>{t("settings.devDesc")}</p>
        <div className="panel-inset" style={{ padding: "0.9rem 1.1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ minWidth: 220, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: "0.9rem" }}>{t("settings.devCalibrateTitle")}</div>
            <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "2px 0 0" }}>{t("settings.devCalibrateDesc")}</p>
          </div>
          <Link href="/map-calibration" className="btn btn-primary" style={{ padding: "0.4rem 0.8rem" }}>
            <Icon name="pin" size={15} /> {t("settings.devCalibrateBtn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
