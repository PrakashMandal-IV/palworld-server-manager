"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { api, Icon, fmtTime, toast } from "@/components/ui";

// Broadcast to players: send now, or schedule messages for later (list/edit/delete).
// Delivery prefers the bundled PSMBroadcast UE4SS mod, which shows the message on every
// player's screen via the server's system announce; without the mod it falls back to
// Palworld's REST announce (which lands in the chat feed). Fired schedules auto-remove.
export default function BroadcastPanel({ worldId, running, onGoToUe4ss }) {
  const { t } = useTranslation();
  const [now, setNow] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [when, setWhen] = useState(defaultWhen());
  const [scheduling, setScheduling] = useState(false);
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null); // { id, message, when }
  const [status, setStatus] = useState(null); // { modInstalled, ue4ssInstalled, bundledAvailable }
  const [installing, setInstalling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now()); // ticks every second for live countdowns
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api(`/api/worlds/${worldId}/broadcasts`);
      setList(r.broadcasts || []);
      setStatus({ modInstalled: r.modInstalled, ue4ssInstalled: r.ue4ssInstalled, bundledAvailable: r.bundledAvailable });
    } catch { /* best effort */ }
  }, [worldId]);

  useEffect(() => {
    load();
    // poll so fired schedules drop out and missed ones show up on their own
    timer.current = setInterval(load, 15000);
    return () => clearInterval(timer.current);
  }, [load]);

  // Drive the per-entry hh:mm:ss countdowns.
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const installMod = async () => {
    if (running) return toast(t("broadcast.stopBeforeMod"), "error");
    setInstalling(true);
    try {
      const r = await api(`/api/worlds/${worldId}/broadcasts/mod`, { method: "POST" });
      toast(r.ue4ssDetected
        ? t("broadcast.modInstalledRestart")
        : t("broadcast.modCopiedNoUe4ss"),
        r.ue4ssDetected ? "success" : "error");
      load();
    } catch (e) { toast(e.message, "error"); }
    finally { setInstalling(false); }
  };

  const removeMod = async () => {
    if (running) return toast(t("broadcast.stopBeforeMod"), "error");
    if (!confirm(t("broadcast.confirmRemoveMod"))) return;
    setRemoving(true);
    try {
      await api(`/api/worlds/${worldId}/broadcasts/mod`, { method: "DELETE" });
      toast(t("broadcast.modRemoved"), "success");
      load();
    } catch (e) { toast(e.message, "error"); }
    finally { setRemoving(false); }
  };

  const sendNow = async () => {
    const message = now.trim();
    if (!message) return;
    setSending(true);
    try {
      await api(`/api/worlds/${worldId}/broadcasts`, { method: "POST", body: { message, immediate: true } });
      toast(t("broadcast.sent"), "success");
      setNow("");
    } catch (e) { toast(e.message, "error"); }
    finally { setSending(false); }
  };

  const schedule = async () => {
    const message = msg.trim();
    if (!message) return toast(t("broadcast.enterMessage"), "error");
    const fire_at = new Date(when).getTime();
    if (!fire_at || fire_at <= Date.now()) return toast(t("broadcast.pickFuture"), "error");
    setScheduling(true);
    try {
      await api(`/api/worlds/${worldId}/broadcasts`, { method: "POST", body: { message, fire_at } });
      toast(t("broadcast.scheduled"), "success");
      setMsg(""); setWhen(defaultWhen());
      load();
    } catch (e) { toast(e.message, "error"); }
    finally { setScheduling(false); }
  };

  const remove = async (id) => {
    try { await api(`/api/worlds/${worldId}/broadcasts/${id}`, { method: "DELETE" }); load(); }
    catch (e) { toast(e.message, "error"); }
  };

  // Deliver a (usually missed) scheduled entry right now, then drop it from the list.
  const sendEntryNow = async (b) => {
    if (!running) return toast(t("broadcast.startToBroadcast"), "error");
    try {
      await api(`/api/worlds/${worldId}/broadcasts`, { method: "POST", body: { message: b.message, immediate: true } });
      await api(`/api/worlds/${worldId}/broadcasts/${b.id}`, { method: "DELETE" });
      toast(t("broadcast.sent"), "success");
      load();
    } catch (e) { toast(e.message, "error"); }
  };

  const saveEdit = async () => {
    const fire_at = new Date(editing.when).getTime();
    if (!editing.message.trim()) return toast(t("broadcast.messageEmpty"), "error");
    if (!fire_at || fire_at <= Date.now()) return toast(t("broadcast.pickFuture"), "error");
    try {
      await api(`/api/worlds/${worldId}/broadcasts/${editing.id}`, { method: "PATCH", body: { message: editing.message.trim(), fire_at } });
      setEditing(null); load();
      toast(t("broadcast.updated"), "success");
    } catch (e) { toast(e.message, "error"); }
  };

  const modOn = status && status.modInstalled;

  return (
    <div style={{ display: "grid", gap: "1.6rem" }}>
      {/* On-screen mod setup / status */}
      {status && !modOn && !status.ue4ssInstalled && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--yellow)" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>{t("broadcast.wantOnScreenTitle")}</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 8px" }}>
            {t("broadcast.wantOnScreenDesc")}
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" style={{ padding: "0.35rem 0.7rem" }} onClick={onGoToUe4ss}>
              <Icon name="shield" size={15} /> {t("broadcast.installUe4ss")}
            </button>
            <button className="btn btn-ghost" style={{ padding: "0.35rem 0.7rem" }}
              onClick={installMod} disabled={installing || running || !status.bundledAvailable}>
              {installing ? t("broadcast.copying") : t("broadcast.copyAnyway")}
            </button>
          </div>
          {running && <p className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", margin: "8px 0 0" }}>{t("broadcast.stopToChangeMod")}</p>}
        </div>
      )}

      {status && !modOn && status.ue4ssInstalled && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--yellow)" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>{t("broadcast.enableTitle")}</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 8px" }}>
            {t("broadcast.enableDesc")}
          </p>
          <button className="btn btn-primary" style={{ padding: "0.35rem 0.7rem" }}
            onClick={installMod} disabled={installing || running || !status.bundledAvailable}>
            <Icon name="download" size={15} /> {installing ? t("broadcast.installing") : t("broadcast.installMod")}
          </button>
          {running && <p className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", margin: "8px 0 0" }}>{t("broadcast.stopToInstall")}</p>}
        </div>
      )}

      {modOn && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
          <div className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem", flex: 1, minWidth: 200 }}>
            <span className="s-running">{t("broadcast.modOnLabel")}</span>{t("broadcast.modOnRest")}
          </div>
          <button className="btn btn-danger" style={{ padding: "0.3rem 0.6rem", fontSize: "0.76rem" }}
            onClick={removeMod} disabled={removing || running} title={running ? t("broadcast.stopToRemoveMod") : undefined}>
            <Icon name="trash" size={14} /> {removing ? t("broadcast.removing") : t("broadcast.removeMod")}
          </button>
        </div>
      )}

      {/* Send now */}
      <section>
        <h3 className="heading" style={{ fontSize: "1rem", marginTop: 0 }}>{t("broadcast.sendNowTitle")}</h3>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input className="input" placeholder={t("broadcast.messagePlaceholder")} value={now}
            onChange={(e) => setNow(e.target.value)} disabled={!running}
            onKeyDown={(e) => { if (e.key === "Enter") sendNow(); }} />
          <button className="btn btn-primary" onClick={sendNow} disabled={!running || sending || !now.trim()}>
            <Icon name="bell" /> {sending ? t("broadcast.sending") : t("broadcast.sendNow")}
          </button>
        </div>
        {!running && <p className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", marginTop: 4 }}>{t("broadcast.startToBroadcast")}</p>}
      </section>

      {/* Schedule */}
      <section>
        <h3 className="heading" style={{ fontSize: "1rem" }}>{t("broadcast.scheduleTitle")}</h3>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="label">{t("broadcast.messageLabel")}</label>
            <input className="input" placeholder={t("broadcast.schedulePlaceholder")} value={msg} onChange={(e) => setMsg(e.target.value)} />
          </div>
          <div>
            <label className="label">{t("broadcast.whenLabel")}</label>
            <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={schedule} disabled={scheduling}><Icon name="plus" /> {t("broadcast.scheduleBtn")}</button>
        </div>

        <div style={{ marginTop: "1rem" }}>
          {list.length === 0 ? (
            <p className="subtle" style={{ fontWeight: 700 }}>{t("broadcast.noneScheduled")}</p>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {list.map((b) => (
                <div key={b.id} className="panel-inset" style={{ padding: "0.6rem 0.8rem" }}>
                  {editing?.id === b.id ? (
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <label className="label">{t("broadcast.messageLabel")}</label>
                        <input className="input" value={editing.message} onChange={(e) => setEditing({ ...editing, message: e.target.value })} />
                      </div>
                      <div>
                        <label className="label">{t("broadcast.whenLabel")}</label>
                        <input className="input" type="datetime-local" value={editing.when} onChange={(e) => setEditing({ ...editing, when: e.target.value })} />
                      </div>
                      <button className="btn btn-primary" onClick={saveEdit}><Icon name="check" size={14} /> {t("common.save")}</button>
                      <button className="btn btn-ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                    </div>
                  ) : b.status === "missed" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                      <span style={{ color: "var(--red)", display: "inline-flex" }}><Icon name="alert" size={16} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: "0.84rem", overflowWrap: "anywhere" }}>{b.message}</div>
                        <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--red)" }}>
                          {t("broadcast.missedLine", { time: fmtTime(b.fire_at) })}
                        </div>
                      </div>
                      <button className="btn btn-primary" style={{ padding: "0.3rem 0.6rem" }} onClick={() => sendEntryNow(b)} disabled={!running} title={running ? undefined : t("broadcast.startToBroadcast")}>
                        <Icon name="bell" size={14} /> {t("broadcast.sendNow")}
                      </button>
                      <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={() => setEditing({ id: b.id, message: b.message, when: defaultWhen() })}>
                        <Icon name="clock" size={14} /> {t("broadcast.reschedule")}
                      </button>
                      <button className="btn btn-danger" style={{ padding: "0.3rem 0.6rem" }} onClick={() => remove(b.id)}><Icon name="trash" size={14} /></button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                      <Icon name="bell" size={16} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: "0.84rem", overflowWrap: "anywhere" }}>{b.message}</div>
                        <div className="subtle" style={{ fontSize: "0.72rem", fontWeight: 700 }}>
                          {t("broadcast.fires", { time: fmtTime(b.fire_at) })}<span style={{ fontVariantNumeric: "tabular-nums" }}>{countdown(b.fire_at, nowTs, t)}</span>
                        </div>
                      </div>
                      <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={() => setEditing({ id: b.id, message: b.message, when: toLocalInput(b.fire_at) })}>
                        <Icon name="settings" size={14} /> {t("common.edit")}
                      </button>
                      <button className="btn btn-danger" style={{ padding: "0.3rem 0.6rem" }} onClick={() => remove(b.id)}><Icon name="trash" size={14} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem", marginTop: "0.8rem" }}>
          <Icon name="info" size={12} />{" "}
          {modOn ? t("broadcast.footerModOn") : t("broadcast.footerModOff")}
        </p>
      </section>
    </div>
  );
}

// Live "in hh:mm:ss" until fire_at, counting down against the ticking now.
function countdown(fireAt, now, t) {
  let s = Math.floor((fireAt - now) / 1000);
  if (s <= 0) return t("broadcast.firing");
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = (n) => String(n).padStart(2, "0");
  const hms = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return d > 0 ? t("broadcast.inDaysTime", { days: d, time: hms }) : t("broadcast.inTime", { time: hms });
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function defaultWhen() {
  return toLocalInput(Date.now() + 10 * 60 * 1000); // 10 minutes from now
}
