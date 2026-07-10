"use client";
import { useState } from "react";
import { api, Icon, fmtTime, toast } from "@/components/ui";

export default function SchedulePanel({ worldId, world, schedules, onChange }) {
  const [jobType, setJobType] = useState("restart");
  const [mode, setMode] = useState("interval");
  const [intervalHours, setIntervalHours] = useState(6);
  const [timeOfDay, setTimeOfDay] = useState("04:00");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      await api(`/api/worlds/${worldId}/schedules`, {
        method: "POST",
        body: {
          job_type: jobType, mode,
          interval_hours: mode === "interval" ? Number(intervalHours) : null,
          time_of_day: mode === "daily" ? timeOfDay : null,
        },
      });
      toast("Schedule added", "success");
      onChange();
    } catch (e) { toast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const remove = async (sid) => {
    try {
      await api(`/api/worlds/${worldId}/schedules?sid=${sid}`, { method: "DELETE" });
      onChange();
    } catch (e) { toast(e.message, "error"); }
  };

  const describe = (s) =>
    `${s.job_type[0].toUpperCase()}${s.job_type.slice(1)} · ${s.mode === "interval" ? `every ${s.interval_hours}h` : `daily at ${s.time_of_day}`}`;

  return (
    <div>
      {world && <WarningConfig world={world} onChange={onChange} />}
      <div className="panel-inset" style={{ padding: "0.9rem", marginBottom: "1rem", display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label className="label">Job</label>
          <select className="input" value={jobType} onChange={(e) => setJobType(e.target.value)}>
            <option value="restart">Restart</option>
            <option value="backup">Backup</option>
            <option value="update">Update</option>
          </select>
        </div>
        <div>
          <label className="label">When</label>
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="interval">Every N hours</option>
            <option value="daily">Daily at time</option>
          </select>
        </div>
        {mode === "interval" ? (
          <div>
            <label className="label">Hours</label>
            <input className="input" type="number" min="1" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} style={{ width: 90 }} />
          </div>
        ) : (
          <div>
            <label className="label">Time</label>
            <input className="input" type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} style={{ width: 120 }} />
          </div>
        )}
        <button className="btn btn-primary" onClick={add} disabled={busy}><Icon name="plus" /> Add</button>
      </div>

      {schedules.length === 0 ? (
        <p className="subtle" style={{ fontWeight: 700 }}>No scheduled jobs. Add automatic restarts, backups, or updates on a maintenance window.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {schedules.map((s) => (
            <div key={s.id} className="panel-inset" style={{ padding: "0.6rem 0.8rem", display: "flex", alignItems: "center", gap: "0.8rem" }}>
              <Icon name="clock" size={16} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: "0.84rem" }}>{describe(s)}</div>
                <div className="subtle" style={{ fontSize: "0.72rem", fontWeight: 700 }}>Last run: {s.last_run ? fmtTime(s.last_run) : "never"}</div>
              </div>
              <button className="btn btn-danger" style={{ padding: "0.3rem 0.6rem" }} onClick={() => remove(s.id)}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Per-world player-warning countdown shown before a scheduled OR manual
// restart/update. Broadcasts announce messages at each interval, then Palworld's
// native red shutdown countdown covers the final minute.
function WarningConfig({ world, onChange }) {
  const [enabled, setEnabled] = useState(!!world.warn_enabled);
  const [lead, setLead] = useState(world.warn_lead_minutes ?? 10);
  const [interval, setInterval] = useState(world.warn_interval_minutes ?? 2);
  const [message, setMessage] = useState(world.warn_message || "The server will restart in {minutes} minute(s). Please get to a safe place.");
  const [saving, setSaving] = useState(false);

  const dirty =
    enabled !== !!world.warn_enabled ||
    Number(lead) !== (world.warn_lead_minutes ?? 10) ||
    Number(interval) !== (world.warn_interval_minutes ?? 2) ||
    message !== (world.warn_message || "");

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/worlds/${world.world_id}`, {
        method: "PATCH",
        body: {
          warn_enabled: enabled ? 1 : 0,
          warn_lead_minutes: Math.max(0, Number(lead) || 0),
          warn_interval_minutes: Math.max(0, Number(interval) || 0),
          warn_message: message,
        },
      });
      toast("Warning settings saved", "success");
      onChange();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="panel-inset" style={{ padding: "1rem 1.1rem", marginBottom: "1rem", borderLeft: `3px solid ${enabled ? "var(--red, #e5484d)" : "var(--line-strong)"}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ minWidth: 240, flex: 1 }}>
          <div className="heading" style={{ fontSize: "0.95rem" }}>Warn players before restart / update</div>
          <div className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", marginTop: 2 }}>
            Broadcasts a countdown in-game before a scheduled <b>or</b> manual restart/update, then hands off to
            Palworld&apos;s native red shutdown countdown for the final minute. Requires the REST API (on by default).
          </div>
        </div>
        <button className={`btn ${enabled ? "btn-primary" : "btn-ghost"}`} onClick={() => setEnabled((v) => !v)}>
          <span className="statdot" style={{ background: enabled ? "var(--accent-ink)" : "var(--ink-soft)" }} /> {enabled ? "On" : "Off"}
        </button>
      </div>

      {enabled && (
        <>
          <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "0.9rem", alignItems: "flex-end" }}>
            <div>
              <label className="label">Start warning (min before)</label>
              <input className="input" type="number" min="1" value={lead} onChange={(e) => setLead(e.target.value)} style={{ width: 130 }} />
            </div>
            <div>
              <label className="label">Repeat every (min)</label>
              <input className="input" type="number" min="0" value={interval} onChange={(e) => setInterval(e.target.value)} style={{ width: 130 }} />
            </div>
          </div>
          <div style={{ marginTop: "0.8rem" }}>
            <label className="label">Message ({"{minutes}"} and {"{seconds}"} are filled in)</label>
            <input className="input" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem", marginTop: 6 }}>
            Set <b>Repeat every</b> to 0 (or ≥ the start time) to warn just once. Example: start 10, repeat 2 → notices at
            10, 8, 6, 4, 2 minutes, then the red countdown.
          </p>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.9rem" }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
          <Icon name="download" /> {saving ? "Saving…" : "Save warnings"}
        </button>
      </div>
    </div>
  );
}
