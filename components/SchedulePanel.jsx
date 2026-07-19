"use client";
import { useEffect, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, fmtTime, toast } from "@/components/ui";

const MESSAGE_JOBS = ["system_message", "onscreen_notice"];

export default function SchedulePanel({ worldId, world, schedules, onChange, onGoToBroadcast }) {
  const { t } = useTranslation();
  const [jobType, setJobType] = useState("restart");
  const [mode, setMode] = useState("interval");
  const [intervalHours, setIntervalHours] = useState(6);
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [timeOfDay, setTimeOfDay] = useState("04:00");
  const [message, setMessage] = useState("");
  const [joinMatch, setJoinMatch] = useState("");
  const [joinDelay, setJoinDelay] = useState(10);
  const [busy, setBusy] = useState(false);
  const [onScreenReady, setOnScreenReady] = useState(null); // null = unknown, true/false once checked

  const isMessageJob = MESSAGE_JOBS.includes(jobType);
  const isIdleJob = jobType === "idle_stop";

  // On-screen notices are delivered through the PSMBroadcast mod, which is set up on
  // the Broadcast tab. Check whether it's installed so we can warn (and offer a jump
  // there) when the user picks an on-screen notice without it.
  useEffect(() => {
    let alive = true;
    api(`/api/worlds/${worldId}/broadcasts`)
      .then((r) => { if (alive) setOnScreenReady(!!r.modInstalled); })
      .catch(() => { if (alive) setOnScreenReady(null); });
    return () => { alive = false; };
  }, [worldId]);

  const onScreenModMissing = jobType === "onscreen_notice" && onScreenReady === false;

  // Switching jobs can leave the mode on something the new job doesn't support: the
  // join trigger is message-only, and idle auto-stop only takes an elapsed-time
  // threshold (no daily/on_join). Snap back to a valid mode in either case.
  const onJobType = (v) => {
    setJobType(v);
    if (mode === "on_join" && !MESSAGE_JOBS.includes(v)) setMode("interval");
    if (v === "idle_stop" && !["interval", "minutes"].includes(mode)) setMode("interval");
  };

  const add = async () => {
    if (isMessageJob && !message.trim()) return toast(t("schedule.messageRequired"), "error");
    setBusy(true);
    try {
      await api(`/api/worlds/${worldId}/schedules`, {
        method: "POST",
        body: {
          job_type: jobType, mode,
          interval_hours: mode === "interval" ? Number(intervalHours) : null,
          interval_minutes: mode === "minutes" ? Number(intervalMinutes) : null,
          time_of_day: mode === "daily" ? timeOfDay : null,
          message: isMessageJob ? message.trim() : null,
          join_match: mode === "on_join" ? joinMatch.trim() : null,
          join_delay_seconds: mode === "on_join" ? Number(joinDelay) : null,
        },
      });
      toast(t("schedule.added"), "success");
      setMessage(""); setJoinMatch("");
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

  const describeWhen = (s) => {
    if (s.job_type === "idle_stop") {
      return s.mode === "minutes"
        ? t("schedule.idleAfterMinutes", { minutes: s.interval_minutes })
        : t("schedule.idleAfterHours", { hours: s.interval_hours });
    }
    if (s.mode === "minutes") return t("schedule.everyMinutes", { minutes: s.interval_minutes });
    if (s.mode === "daily") return t("schedule.dailyAt", { time: s.time_of_day });
    if (s.mode === "on_join") {
      const who = s.join_match ? t("schedule.whenPlayerJoins", { name: s.join_match }) : t("schedule.whenAnyJoins");
      const delay = Math.max(0, Number(s.join_delay_seconds) || 0);
      return delay ? `${who} ${t("schedule.afterDelay", { seconds: delay })}` : who;
    }
    return t("schedule.everyHours", { hours: s.interval_hours });
  };
  const describe = (s) => {
    const head = `${t(`schedule.jobType.${s.job_type}`, { defaultValue: s.job_type })} · ${describeWhen(s)}`;
    return s.message ? `${head} — "${s.message}"` : head;
  };

  return (
    <div>
      {world && <WarningConfig world={world} onChange={onChange} />}
      <div className="panel-inset" style={{ padding: "0.9rem", marginBottom: "1rem", display: "grid", gap: "0.6rem" }}>
        {onScreenModMissing && (
          <div className="panel-inset" style={{ padding: "0.7rem 0.9rem", borderLeft: "3px solid var(--yellow)", display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 800, fontSize: "0.85rem" }}>{t("schedule.onscreenNeedsModTitle")}</div>
              <div className="subtle" style={{ fontWeight: 600, fontSize: "0.76rem", marginTop: 2 }}>{t("schedule.onscreenNeedsModDesc")}</div>
            </div>
            {onGoToBroadcast && (
              <button className="btn btn-primary" style={{ padding: "0.4rem 0.75rem" }} onClick={onGoToBroadcast}>
                <Icon name="bell" size={14} /> {t("schedule.setUpInBroadcast")}
              </button>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label className="label">{t("schedule.job")}</label>
            <select className="input" value={jobType} onChange={(e) => onJobType(e.target.value)}>
              <option value="restart">{t("schedule.jobType.restart")}</option>
              <option value="backup">{t("schedule.jobType.backup")}</option>
              <option value="update">{t("schedule.jobType.update")}</option>
              <option value="system_message">{t("schedule.jobType.system_message")}</option>
              <option value="onscreen_notice">{t("schedule.jobType.onscreen_notice")}</option>
              <option value="idle_stop">{t("schedule.jobType.idle_stop")}</option>
            </select>
          </div>
          <div>
            <label className="label">{t("schedule.when")}</label>
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="interval">{isIdleJob ? t("schedule.afterNHours") : t("schedule.everyNHours")}</option>
              <option value="minutes">{isIdleJob ? t("schedule.afterNMinutes") : t("schedule.everyNMinutes")}</option>
              {!isIdleJob && <option value="daily">{t("schedule.dailyAtTime")}</option>}
              {isMessageJob && <option value="on_join">{t("schedule.whenJoins")}</option>}
            </select>
          </div>
          {mode === "interval" && (
            <div>
              <label className="label">{t("schedule.hours")}</label>
              <input className="input" type="number" min="1" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} style={{ width: 90 }} />
            </div>
          )}
          {mode === "minutes" && (
            <div>
              <label className="label">{t("schedule.minutes")}</label>
              <input className="input" type="number" min="1" value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} style={{ width: 90 }} />
            </div>
          )}
          {mode === "daily" && (
            <div>
              <label className="label">{t("schedule.time")}</label>
              <input className="input" type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} style={{ width: 120 }} />
            </div>
          )}
          {mode === "on_join" && (
            <>
              <div>
                <label className="label">{t("schedule.playerFilter")}</label>
                <input className="input" value={joinMatch} onChange={(e) => setJoinMatch(e.target.value)} placeholder={t("schedule.playerPlaceholder")} style={{ width: 200 }} />
              </div>
              <div>
                <label className="label">{t("schedule.joinDelay")}</label>
                <input className="input" type="number" min="0" max="3600" value={joinDelay} onChange={(e) => setJoinDelay(e.target.value)} style={{ width: 90 }} title={t("schedule.joinDelayTip")} />
              </div>
            </>
          )}
          <button className="btn btn-primary" onClick={add} disabled={busy}><Icon name="plus" /> {t("schedule.add")}</button>
        </div>
        {isMessageJob && (
          <div>
            <label className="label">{t("schedule.message")}</label>
            <input className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("schedule.messagePlaceholder")} />
            <p className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem", marginTop: 4, marginBottom: 0 }}>
              {t(jobType === "onscreen_notice" ? "schedule.onscreenHint" : "schedule.systemHint")}
              {mode === "on_join" && ` ${t("schedule.playerFilterHint")} ${t("schedule.joinDelayHint")} ${t("schedule.playerTokenHint")}`}
            </p>
          </div>
        )}
        {isIdleJob && (
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem", margin: 0 }}>
            {t("schedule.idleHint")}
          </p>
        )}
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
