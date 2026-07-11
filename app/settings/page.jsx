"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/components/ThemeProvider";
import { api, Icon, toast } from "@/components/ui";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [s, setS] = useState(null);
  const [steam, setSteam] = useState(null);
  const [saving, setSaving] = useState(false);
  const [backupLoc, setBackupLoc] = useState(null);
  const [backupPath, setBackupPath] = useState("");
  const isElectron = typeof window !== "undefined" && window.desktop?.isElectron;

  useEffect(() => {
    api("/api/settings").then((r) => setS(r.settings)).catch(() => {});
    api("/api/steamcmd").then(setSteam).catch(() => {});
    api("/api/settings/backup-dir").then((r) => { setBackupLoc(r.backup); setBackupPath(r.backup.custom ? r.backup.path : ""); }).catch(() => {});
  }, []);

  const saveBackupDir = async (p) => {
    setSaving(true);
    try {
      const r = await api("/api/settings/backup-dir", { method: "POST", body: { path: p } });
      setBackupLoc(r.backup);
      setBackupPath(r.backup.custom ? r.backup.path : "");
      toast(r.backup.custom ? "Backup location updated" : "Reset to default location", "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const pickBackupDir = async () => {
    if (!isElectron) return;
    const p = await window.desktop.pickDirectory();
    if (p) setBackupPath(p);
  };

  const save = async (patch) => {
    setSaving(true);
    try {
      const r = await api("/api/settings", { method: "POST", body: patch });
      setS(r.settings);
      toast("Saved", "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  if (!s) return <div className="subtle" style={{ fontWeight: 700 }}>Loading…</div>;

  return (
    <div>
      <h1 className="heading" style={{ fontSize: "1.9rem", margin: "0 0 1.2rem" }}>Settings</h1>

      <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>Appearance</h3>
        <label className="label">Theme</label>
        <div style={{ display: "flex", gap: "0.6rem" }}>
          <button className={`btn ${theme === "light" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTheme("light")}><Icon name="sun" /> Light</button>
          <button className={`btn ${theme === "dark" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTheme("dark")}><Icon name="moon" /> Dark</button>
        </div>
      </div>

      <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>Discord notifications</h3>
        <div className="panel-inset" style={{ padding: "0.9rem 1.1rem", borderLeft: "3px solid var(--yellow)" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>This moved into each world</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.8rem", margin: 0 }}>
            Discord webhooks are now set <b>per world</b>, so each server can post to its own channel.
            Open a world → <b>Discord</b> tab to add its webhook, choose which events to announce, and
            toggle chat relay. Any webhook you had here before has been cleared.
          </p>
          <Link href="/" className="btn btn-primary" style={{ marginTop: "0.8rem", padding: "0.35rem 0.7rem" }}>
            <Icon name="globe" size={15} /> Go to your worlds
          </Link>
        </div>
      </div>

      <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>In-game chat capture</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <button className={`btn ${s.chatCaptureEnabled !== false ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.35rem 0.7rem" }}
            onClick={() => save({ chatCaptureEnabled: !(s.chatCaptureEnabled !== false) })} disabled={saving}>
            {s.chatCaptureEnabled !== false ? "On" : "Off"}
          </button>
          <span className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem" }}>
            Capture in-game chat via the UE4SS relay mod. Turn this off to stop the app from
            reading chat entirely. If a Palworld update ever makes the mod misbehave, also use
            <b> Remove chat mod</b> on each world&apos;s Chat tab to take the mod off the server.
          </span>
        </div>
      </div>

      <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>Backups</h3>
        <label className="label">Keep last N backups per world</label>
        <div style={{ display: "flex", gap: "0.5rem", maxWidth: 260 }}>
          <input className="input" type="number" min="1" value={s.backupRetention ?? 10} onChange={(e) => setS({ ...s, backupRetention: Number(e.target.value) })} />
          <button className="btn btn-primary" onClick={() => save({ backupRetention: s.backupRetention })} disabled={saving}>Save</button>
        </div>

        {backupLoc && (
          <div style={{ marginTop: "1.1rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <label className="label">Backup location</label>
            <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 0.5rem" }}>
              Backups are ZIP snapshots of each world&apos;s <b>Saved</b> folder, stored outside the server
              so a game update can&apos;t touch them. Currently saving to{" "}
              <span style={{ fontWeight: 800 }}>{backupLoc.custom ? "a custom folder" : "the default folder"}</span>:
            </p>
            <p className="subtle" style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", margin: "0 0 0.6rem", wordBreak: "break-all" }}>{backupLoc.path}</p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder="Leave blank for the default location"
                value={backupPath} onChange={(e) => setBackupPath(e.target.value)} />
              {isElectron && (
                <button className="btn btn-ghost" onClick={pickBackupDir} disabled={saving}><Icon name="folder" size={15} /> Choose folder</button>
              )}
              <button className="btn btn-primary" onClick={() => saveBackupDir(backupPath)} disabled={saving}>Save</button>
              {backupLoc.custom && (
                <button className="btn btn-ghost" onClick={() => saveBackupDir("")} disabled={saving}>Reset</button>
              )}
            </div>
            <p className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem", margin: "0.5rem 0 0" }}>
              Existing backups stay where they are — only new backups go to the new folder.
            </p>
          </div>
        )}
      </div>

      <div className="panel" style={{ padding: "1.3rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>SteamCMD</h3>
        <p style={{ fontWeight: 700, fontSize: "0.86rem", margin: 0 }}>
          <span className={steam?.installed ? "s-running" : "s-crashed"}>
            {steam?.installed ? "● Installed" : "○ Not installed yet"}
          </span>
          <span className="subtle"> — installed automatically on first world provisioning.</span>
        </p>
        {steam?.path && <p className="subtle" style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", marginTop: 6 }}>{steam.path}</p>}
      </div>
    </div>
  );
}
