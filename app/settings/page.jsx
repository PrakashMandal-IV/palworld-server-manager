"use client";
import { useEffect, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";
import { api, Icon, toast } from "@/components/ui";

const EVENT_KINDS = ["start", "stop", "restart", "crash", "backup", "update"];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [s, setS] = useState(null);
  const [steam, setSteam] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api("/api/settings").then((r) => setS(r.settings)).catch(() => {});
    api("/api/steamcmd").then(setSteam).catch(() => {});
  }, []);

  const save = async (patch) => {
    setSaving(true);
    try {
      const r = await api("/api/settings", { method: "POST", body: patch });
      setS(r.settings);
      toast("Saved", "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await api("/api/settings/test-notify", { method: "POST", body: { webhook: s.discordWebhook } });
      toast("Test message sent — check your Discord channel", "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setTesting(false); }
  };

  if (!s) return <div className="subtle" style={{ fontWeight: 700 }}>Loading…</div>;

  const notify = s.notifyEvents || {};

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
        <label className="label">Webhook URL</label>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <input className="input" value={s.discordWebhook || ""} onChange={(e) => setS({ ...s, discordWebhook: e.target.value })} placeholder="https://discord.com/api/webhooks/…" />
          <button className="btn btn-ghost" onClick={sendTest} disabled={testing || !s.discordWebhook}>{testing ? "Sending…" : "Send test"}</button>
          <button className="btn btn-primary" onClick={() => save({ discordWebhook: s.discordWebhook })} disabled={saving}>Save</button>
        </div>
        <label className="label">Notify on</label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {EVENT_KINDS.map((k) => {
            const on = notify[k] !== false;
            return (
              <button key={k} className={`btn ${on ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.35rem 0.7rem" }}
                onClick={() => save({ notifyEvents: { ...notify, [k]: !on } })}>
                {k}
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>Backups</h3>
        <label className="label">Keep last N backups per world</label>
        <div style={{ display: "flex", gap: "0.5rem", maxWidth: 260 }}>
          <input className="input" type="number" min="1" value={s.backupRetention ?? 10} onChange={(e) => setS({ ...s, backupRetention: Number(e.target.value) })} />
          <button className="btn btn-primary" onClick={() => save({ backupRetention: s.backupRetention })} disabled={saving}>Save</button>
        </div>
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
