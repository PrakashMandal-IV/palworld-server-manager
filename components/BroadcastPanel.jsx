"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { api, Icon, fmtTime, toast } from "@/components/ui";

// Broadcast to players: send now, or schedule messages for later (list/edit/delete).
// Delivery prefers the bundled PSMBroadcast UE4SS mod, which shows the message on every
// player's screen via the server's system announce; without the mod it falls back to
// Palworld's REST announce (which lands in the chat feed). Fired schedules auto-remove.
export default function BroadcastPanel({ worldId, running, onGoToUe4ss }) {
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
    if (running) return toast("Stop the world before changing the broadcast mod.", "error");
    setInstalling(true);
    try {
      const r = await api(`/api/worlds/${worldId}/broadcasts/mod`, { method: "POST" });
      toast(r.ue4ssDetected
        ? "On-screen broadcast mod installed. Restart the world to load it."
        : "Broadcast mod copied, but UE4SS was not detected — install UE4SS first.",
        r.ue4ssDetected ? "success" : "error");
      load();
    } catch (e) { toast(e.message, "error"); }
    finally { setInstalling(false); }
  };

  const removeMod = async () => {
    if (running) return toast("Stop the world before changing the broadcast mod.", "error");
    if (!confirm("Remove the on-screen broadcast mod? Broadcasts fall back to the chat-feed announce until you reinstall it. Restart the world to fully unload the mod.")) return;
    setRemoving(true);
    try {
      await api(`/api/worlds/${worldId}/broadcasts/mod`, { method: "DELETE" });
      toast("Broadcast mod removed. Restart the world to unload it.", "success");
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
      toast("Broadcast sent", "success");
      setNow("");
    } catch (e) { toast(e.message, "error"); }
    finally { setSending(false); }
  };

  const schedule = async () => {
    const message = msg.trim();
    if (!message) return toast("Enter a message", "error");
    const fire_at = new Date(when).getTime();
    if (!fire_at || fire_at <= Date.now()) return toast("Pick a time in the future", "error");
    setScheduling(true);
    try {
      await api(`/api/worlds/${worldId}/broadcasts`, { method: "POST", body: { message, fire_at } });
      toast("Broadcast scheduled", "success");
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
    if (!running) return toast("Start the world to broadcast.", "error");
    try {
      await api(`/api/worlds/${worldId}/broadcasts`, { method: "POST", body: { message: b.message, immediate: true } });
      await api(`/api/worlds/${worldId}/broadcasts/${b.id}`, { method: "DELETE" });
      toast("Broadcast sent", "success");
      load();
    } catch (e) { toast(e.message, "error"); }
  };

  const saveEdit = async () => {
    const fire_at = new Date(editing.when).getTime();
    if (!editing.message.trim()) return toast("Message can't be empty", "error");
    if (!fire_at || fire_at <= Date.now()) return toast("Pick a time in the future", "error");
    try {
      await api(`/api/worlds/${worldId}/broadcasts/${editing.id}`, { method: "PATCH", body: { message: editing.message.trim(), fire_at } });
      setEditing(null); load();
      toast("Broadcast updated", "success");
    } catch (e) { toast(e.message, "error"); }
  };

  const modOn = status && status.modInstalled;

  return (
    <div style={{ display: "grid", gap: "1.6rem" }}>
      {/* On-screen mod setup / status */}
      {status && !modOn && !status.ue4ssInstalled && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--yellow)" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>Want broadcasts on players&apos; screens?</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 8px" }}>
            Right now broadcasts go out through Palworld&apos;s REST announce, which shows in the
            chat feed. For an on-screen system message, add the bundled broadcast mod — it needs
            UE4SS (the Lua mod loader), which isn&apos;t installed on this world yet.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" style={{ padding: "0.35rem 0.7rem" }} onClick={onGoToUe4ss}>
              <Icon name="shield" size={15} /> Install UE4SS →
            </button>
            <button className="btn btn-ghost" style={{ padding: "0.35rem 0.7rem" }}
              onClick={installMod} disabled={installing || running || !status.bundledAvailable}>
              {installing ? "Copying…" : "Copy broadcast mod anyway"}
            </button>
          </div>
          {running && <p className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", margin: "8px 0 0" }}>Stop the world to change the broadcast mod.</p>}
        </div>
      )}

      {status && !modOn && status.ue4ssInstalled && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--yellow)" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>Enable on-screen broadcasts</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 8px" }}>
            UE4SS is installed. Add the bundled broadcast mod to show messages on every player&apos;s
            screen, then restart the world to load it. Until then, broadcasts appear in the chat feed.
          </p>
          <button className="btn btn-primary" style={{ padding: "0.35rem 0.7rem" }}
            onClick={installMod} disabled={installing || running || !status.bundledAvailable}>
            <Icon name="download" size={15} /> {installing ? "Installing…" : "Install broadcast mod"}
          </button>
          {running && <p className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", margin: "8px 0 0" }}>Stop the world to install the broadcast mod.</p>}
        </div>
      )}

      {modOn && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
          <div className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem", flex: 1, minWidth: 200 }}>
            <span className="s-running">● On-screen broadcast mod installed</span> — messages show as the on-screen server notice while the world runs.
          </div>
          <button className="btn btn-danger" style={{ padding: "0.3rem 0.6rem", fontSize: "0.76rem" }}
            onClick={removeMod} disabled={removing || running} title={running ? "Stop the world to remove the broadcast mod" : undefined}>
            <Icon name="trash" size={14} /> {removing ? "Removing…" : "Remove mod"}
          </button>
        </div>
      )}

      {/* Send now */}
      <section>
        <h3 className="heading" style={{ fontSize: "1rem", marginTop: 0 }}>Send a broadcast now</h3>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input className="input" placeholder="Message to show all players…" value={now}
            onChange={(e) => setNow(e.target.value)} disabled={!running}
            onKeyDown={(e) => { if (e.key === "Enter") sendNow(); }} />
          <button className="btn btn-primary" onClick={sendNow} disabled={!running || sending || !now.trim()}>
            <Icon name="bell" /> {sending ? "Sending…" : "Send now"}
          </button>
        </div>
        {!running && <p className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", marginTop: 4 }}>Start the world to broadcast.</p>}
      </section>

      {/* Schedule */}
      <section>
        <h3 className="heading" style={{ fontSize: "1rem" }}>Schedule a broadcast</h3>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="label">Message</label>
            <input className="input" placeholder="e.g. Event starts in 10 minutes!" value={msg} onChange={(e) => setMsg(e.target.value)} />
          </div>
          <div>
            <label className="label">When</label>
            <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={schedule} disabled={scheduling}><Icon name="plus" /> Schedule</button>
        </div>

        <div style={{ marginTop: "1rem" }}>
          {list.length === 0 ? (
            <p className="subtle" style={{ fontWeight: 700 }}>No scheduled broadcasts. They fire once at the set time, then disappear. If the app is closed past the time, the broadcast is kept and flagged as missed.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {list.map((b) => (
                <div key={b.id} className="panel-inset" style={{ padding: "0.6rem 0.8rem" }}>
                  {editing?.id === b.id ? (
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <label className="label">Message</label>
                        <input className="input" value={editing.message} onChange={(e) => setEditing({ ...editing, message: e.target.value })} />
                      </div>
                      <div>
                        <label className="label">When</label>
                        <input className="input" type="datetime-local" value={editing.when} onChange={(e) => setEditing({ ...editing, when: e.target.value })} />
                      </div>
                      <button className="btn btn-primary" onClick={saveEdit}><Icon name="check" size={14} /> Save</button>
                      <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  ) : b.status === "missed" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                      <span style={{ color: "var(--red)", display: "inline-flex" }}><Icon name="alert" size={16} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: "0.84rem", overflowWrap: "anywhere" }}>{b.message}</div>
                        <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--red)" }}>
                          Missed — was due {fmtTime(b.fire_at)}. Reschedule it or send it now.
                        </div>
                      </div>
                      <button className="btn btn-primary" style={{ padding: "0.3rem 0.6rem" }} onClick={() => sendEntryNow(b)} disabled={!running} title={running ? undefined : "Start the world to broadcast"}>
                        <Icon name="bell" size={14} /> Send now
                      </button>
                      <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={() => setEditing({ id: b.id, message: b.message, when: defaultWhen() })}>
                        <Icon name="clock" size={14} /> Reschedule
                      </button>
                      <button className="btn btn-danger" style={{ padding: "0.3rem 0.6rem" }} onClick={() => remove(b.id)}><Icon name="trash" size={14} /></button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                      <Icon name="bell" size={16} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: "0.84rem", overflowWrap: "anywhere" }}>{b.message}</div>
                        <div className="subtle" style={{ fontSize: "0.72rem", fontWeight: 700 }}>
                          Fires {fmtTime(b.fire_at)} · <span style={{ fontVariantNumeric: "tabular-nums" }}>{countdown(b.fire_at, nowTs)}</span>
                        </div>
                      </div>
                      <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={() => setEditing({ id: b.id, message: b.message, when: toLocalInput(b.fire_at) })}>
                        <Icon name="settings" size={14} /> Edit
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
          {modOn
            ? "Broadcasts show on-screen via the installed mod (the server's on-screen notice). The red pre-shutdown countdown look is exclusive to actual shutdowns and can't be triggered for a normal message."
            : "Broadcasts currently go out as Palworld's REST announce (chat feed). Install the on-screen broadcast mod above to show them on players' screens instead."}
        </p>
      </section>
    </div>
  );
}

// Live "in hh:mm:ss" until fire_at, counting down against the ticking now.
function countdown(fireAt, now) {
  let s = Math.floor((fireAt - now) / 1000);
  if (s <= 0) return "firing…";
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = (n) => String(n).padStart(2, "0");
  const hms = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return d > 0 ? `in ${d}d ${hms}` : `in ${hms}`;
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
