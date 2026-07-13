"use client";
import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, fmtTime, toast } from "@/components/ui";

export default function SchedulePanel({ worldId, world, schedules, onChange }) {
  const { t } = useTranslation();
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
      toast(t("schedule.added"), "success");
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
    `${t(`schedule.jobType.${s.job_type}`, { defaultValue: s.job_type })} · ${s.mode === "interval" ? t("schedule.everyHours", { hours: s.interval_hours }) : t("schedule.dailyAt", { time: s.time_of_day })}`;

  return (
    <div>
      {world && <WarningConfig world={world} onChange={onChange} />}
      <div className="panel-inset" style={{ padding: "0.9rem", marginBottom: "1rem", display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label className="label">{t("schedule.job")}</label>
          <select className="input" value={jobType} onChange={(e) => setJobType(e.target.value)}>
            <option value="restart">{t("schedule.jobType.restart")}</option>
            <option value="backup">{t("schedule.jobType.backup")}</option>
            <option value="update">{t("schedule.jobType.update")}</option>
          </select>
        </div>
        <div>
          <label className="label">{t("schedule.when")}</label>
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="interval">{t("schedule.everyNHours")}</option>
            <option value="daily">{t("schedule.dailyAtTime")}</option>
          </select>
        </div>
        {mode === "interval" ? (
          <div>
            <label className="label">{t("schedule.hours")}</label>
            <input className="input" type="number" min="1" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} style={{ width: 90 }} />
          </div>
        ) : (
          <div>
            <label className="label">{t("schedule.time")}</label>
            <input className="input" type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} style={{ width: 120 }} />
          </div>
        )}
        <button className="btn btn-primary" onClick={add} disabled={busy}><Icon name="plus" /> {t("schedule.add")}</button>
      </div>

      {schedules.length === 0 ? (
        <p className="subtle" style={{ fontWeight: 700 }}>{t("schedule.empty")}</p>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {schedules.map((s) => (
            <div key={s.id} className="panel-inset" style={{ padding: "0.6rem 0.8rem", display: "flex", alignItems: "center", gap: "0.8rem" }}>
              <Icon name="clock" size={16} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: "0.84rem" }}>{describe(s)}</div>
                <div className="subtle" style={{ fontSize: "0.72rem", fontWeight: 700 }}>{t("schedule.lastRun", { time: s.last_run ? fmtTime(s.last_run) : t("schedule.never") })}</div>
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
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(!!world.warn_enabled);
  const [lead, setLead] = useState(world.warn_lead_minutes ?? 10);
  const [interval, setInterval] = useState(world.warn_interval_minutes ?? 2);
  const [message, setMessage] = useState(world.warn_message || t("warn.defaultMessage"));
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
      toast(t("warn.saved"), "success");
      onChange();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="panel-inset" style={{ padding: "1rem 1.1rem", marginBottom: "1rem", borderLeft: `3px solid ${enabled ? "var(--red, #e5484d)" : "var(--line-strong)"}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ minWidth: 240, flex: 1 }}>
          <div className="heading" style={{ fontSize: "0.95rem" }}>{t("warn.title")}</div>
          <div className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", marginTop: 2 }}>
            <Trans i18nKey="warn.desc" components={{ b: <b /> }} />
          </div>
        </div>
        <button className={`btn ${enabled ? "btn-primary" : "btn-ghost"}`} onClick={() => setEnabled((v) => !v)}>
          <span className="statdot" style={{ background: enabled ? "var(--accent-ink)" : "var(--ink-soft)" }} /> {enabled ? t("common.on") : t("common.off")}
        </button>
      </div>

      {enabled && (
        <>
          <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "0.9rem", alignItems: "flex-end" }}>
            <div>
              <label className="label">{t("warn.startBefore")}</label>
              <input className="input" type="number" min="1" value={lead} onChange={(e) => setLead(e.target.value)} style={{ width: 130 }} />
            </div>
            <div>
              <label className="label">{t("warn.repeatEvery")}</label>
              <input className="input" type="number" min="0" value={interval} onChange={(e) => setInterval(e.target.value)} style={{ width: 130 }} />
            </div>
          </div>
          <div style={{ marginTop: "0.8rem" }}>
            <label className="label">{t("warn.messageLabel")}</label>
            <input className="input" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem", marginTop: 6 }}>
            <Trans i18nKey="warn.hint" components={{ b: <b /> }} />
          </p>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.9rem" }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
          <Icon name="download" /> {saving ? t("warn.saving") : t("warn.save")}
        </button>
      </div>
    </div>
  );
}
