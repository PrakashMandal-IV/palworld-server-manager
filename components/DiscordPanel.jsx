"use client";
import { useMemo, useState } from "react";
import { api, Icon, toast } from "@/components/ui";
import { normalizeDiscord, ROUTE_KINDS, MAX_HOOKS } from "@/lib/discord-routing";

const KIND_LABELS = {
  start: "Server started",
  stop: "Server stopped",
  restart: "Server restarted",
  crash: "Server crashed",
  backup: "Backup created",
  update: "Server updated",
  chat: "In-game chat relay",
};

const newId = () => `h_${Math.random().toString(36).slice(2, 9)}`;

export default function DiscordPanel({ world, onChange }) {
  const initial = useMemo(
    () => normalizeDiscord(world),
    [world.discord_webhooks, world.discord_webhook, world.notify_events, world.discord_relay_chat]
  );

  const [hooks, setHooks] = useState(initial.hooks);
  const [routes, setRoutes] = useState(initial.routes);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);

  const dirty = JSON.stringify({ hooks, routes }) !== JSON.stringify(initial);

  const addHook = () => {
    if (hooks.length >= MAX_HOOKS) return;
    setHooks((hs) => [...hs, { id: newId(), name: `Channel ${hs.length + 1}`, url: "" }]);
  };
  const patchHook = (id, patch) => setHooks((hs) => hs.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  const removeHook = (id) => {
    setHooks((hs) => hs.filter((h) => h.id !== id));
    setRoutes((rs) => {
      const next = { ...rs };
      for (const k of ROUTE_KINDS) if (next[k] === id) next[k] = "";
      return next;
    });
  };
  const setRoute = (kind, hookId) => setRoutes((rs) => ({ ...rs, [kind]: hookId }));

  const discard = () => { setHooks(initial.hooks); setRoutes(initial.routes); };

  const sendTest = async (hook) => {
    setTestingId(hook.id);
    try {
      await api("/api/settings/test-notify", { method: "POST", body: { webhook: hook.url.trim() } });
      toast("Test message sent — check that Discord channel", "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setTestingId(null); }
  };

  const save = async () => {
    setSaving(true);
    try {
      // Trim, and drop empty channels nothing routes to; clear routes to dropped ones.
      const cleanedHooks = hooks
        .map((h) => ({ id: h.id, name: h.name.trim() || "Webhook", url: h.url.trim() }))
        .filter((h) => h.url || ROUTE_KINDS.some((k) => routes[k] === h.id));
      const validIds = new Set(cleanedHooks.map((h) => h.id));
      const cleanedRoutes = {};
      for (const k of ROUTE_KINDS) cleanedRoutes[k] = validIds.has(routes[k]) ? routes[k] : "";
      await api(`/api/worlds/${world.world_id}`, {
        method: "PATCH",
        body: { discord_webhooks: { hooks: cleanedHooks, routes: cleanedRoutes } },
      });
      toast("Discord settings saved", "success");
      onChange?.();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const hookById = (id) => hooks.find((h) => h.id === id);

  return (
    <div style={{ display: "grid", gap: "1.4rem" }}>
      <section>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>Discord notifications</h3>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.82rem", marginTop: 0, marginBottom: "0.9rem" }}>
          Add one or more Discord webhook channels for this world, then choose which channel each
          event posts to below — e.g. a <b>Status</b> channel for start/stop/crash, a separate
          <b> Backup</b> channel, and a <b>Chat</b> channel for the in-game relay.
        </p>

        {/* ---- Webhook channels ---- */}
        <label className="label">Webhook channels</label>
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {hooks.length === 0 && (
            <div className="panel-inset" style={{ padding: "0.9rem 1.1rem" }}>
              <span className="subtle" style={{ fontWeight: 600, fontSize: "0.8rem" }}>
                No channels yet. Add one to start posting notifications.
              </span>
            </div>
          )}
          {hooks.map((h) => (
            <div key={h.id} className="panel-inset" style={{ padding: "0.7rem 0.9rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input
                className="input" value={h.name} onChange={(e) => patchHook(h.id, { name: e.target.value })}
                placeholder="Channel name" style={{ width: 150 }} aria-label="Channel name" />
              <input
                className="input" value={h.url} onChange={(e) => patchHook(h.id, { url: e.target.value })}
                placeholder="https://discord.com/api/webhooks/…" style={{ flex: 1, minWidth: 240 }} aria-label="Webhook URL" />
              <button className="btn btn-ghost" style={{ padding: "0.4rem 0.7rem" }}
                onClick={() => sendTest(h)} disabled={testingId === h.id || !h.url.trim()}>
                {testingId === h.id ? "Sending…" : "Test"}
              </button>
              <button className="btn btn-danger" style={{ padding: "0.4rem 0.55rem" }}
                onClick={() => removeHook(h.id)} title="Remove channel" aria-label="Remove channel">
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
        <button className="btn btn-ghost" style={{ marginTop: "0.6rem", padding: "0.4rem 0.8rem" }}
          onClick={addHook} disabled={hooks.length >= MAX_HOOKS}>
          <Icon name="plus" size={15} /> Add channel
        </button>
        {hooks.length >= MAX_HOOKS && (
          <span className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem", marginLeft: 8 }}>Maximum of {MAX_HOOKS} channels.</span>
        )}
      </section>

      {/* ---- Per-event routing ---- */}
      <section>
        <label className="label">Route events</label>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", marginTop: 0, marginBottom: "0.7rem" }}>
          Pick the channel each event posts to, or <b>Don&apos;t send</b> to mute it.
        </p>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          {ROUTE_KINDS.map((k) => {
            const routed = routes[k];
            const missingUrl = routed && !(hookById(routed)?.url || "").trim();
            return (
              <div key={k} className="panel-inset" style={{ padding: "0.55rem 0.9rem", display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                <div style={{ minWidth: 150, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.84rem" }}>{KIND_LABELS[k]}</div>
                  {k === "chat" && (
                    <div className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem" }}>
                      Needs the chat relay mod installed on the <b>Chat</b> tab.
                    </div>
                  )}
                  {missingUrl && (
                    <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: "0.72rem" }}>
                      This channel has no webhook URL — nothing will be sent.
                    </div>
                  )}
                </div>
                <select className="input" style={{ width: 200 }} value={routed}
                  onChange={(e) => setRoute(k, e.target.value)} aria-label={`Channel for ${KIND_LABELS[k]}`}>
                  <option value="">Don&apos;t send</option>
                  {hooks.map((h) => (
                    <option key={h.id} value={h.id}>{h.name.trim() || "Webhook"}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </section>

      {/* Unsaved-changes bar */}
      <div className="panel-inset" style={{
        padding: "0.8rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "1rem", flexWrap: "wrap",
        borderLeft: `3px solid ${dirty ? "var(--yellow)" : "var(--line)"}`,
      }}>
        <span style={{ fontWeight: 700, fontSize: "0.82rem" }} className={dirty ? "" : "subtle"}>
          {dirty ? "● You have unsaved changes" : "All changes saved"}
        </span>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-ghost" onClick={discard} disabled={!dirty || saving}>Discard</button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
            <Icon name="download" size={16} /> {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
