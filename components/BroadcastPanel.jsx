"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { api, Icon, fmtTime, toast } from "@/components/ui";

// Broadcast to players: send now, or schedule messages for later (list/edit/delete).
// Delivery uses Palworld's REST announce, shown to players as an on-screen server
// broadcast. Fired schedules are removed automatically.
export default function BroadcastPanel({ worldId, running }) {
  const [now, setNow] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [when, setWhen] = useState(defaultWhen());
  const [scheduling, setScheduling] = useState(false);
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null); // { id, message, when }
  const timer = useRef(null);

  const load = useCallback(async () => {
    try { const r = await api(`/api/worlds/${worldId}/broadcasts`); setList(r.broadcasts || []); }
    catch { /* best effort */ }
  }, [worldId]);

  useEffect(() => {
    load();
    // poll so fired/expired schedules drop out of the list on their own
    timer.current = setInterval(load, 15000);
    return () => clearInterval(timer.current);
  }, [load]);

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

  return (
    <div style={{ display: "grid", gap: "1.6rem" }}>
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
            <p className="subtle" style={{ fontWeight: 700 }}>No scheduled broadcasts. They fire once at the set time, then disappear.</p>
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
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                      <Icon name="bell" size={16} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: "0.84rem", overflowWrap: "anywhere" }}>{b.message}</div>
                        <div className="subtle" style={{ fontSize: "0.72rem", fontWeight: 700 }}>Fires: {fmtTime(b.fire_at)}</div>
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
          <Icon name="info" size={12} /> Broadcasts show as Palworld&apos;s on-screen server message. The red pre-shutdown
          countdown look is exclusive to actual shutdowns and can&apos;t be triggered for a normal message.
        </p>
      </section>
    </div>
  );
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
