"use client";
import { useMemo, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";
import { normalizeDiscord, ROUTE_KINDS, MAX_HOOKS } from "@/lib/discord-routing";

const newId = () => `h_${Math.random().toString(36).slice(2, 9)}`;

export default function DiscordPanel({ world, onChange }) {
  const { t } = useTranslation();
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
      toast(t("discord.testSent"), "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setTestingId(null); }
  };

  const save = async () => {
    setSaving(true);
    try {
      // Trim, and drop empty channels nothing routes to; clear routes to dropped ones.
      const cleanedHooks = hooks
        .map((h) => ({ id: h.id, name: h.name.trim() || t("discord.webhookFallback"), url: h.url.trim() }))
        .filter((h) => h.url || ROUTE_KINDS.some((k) => routes[k] === h.id));
      const validIds = new Set(cleanedHooks.map((h) => h.id));
      const cleanedRoutes = {};
      for (const k of ROUTE_KINDS) cleanedRoutes[k] = validIds.has(routes[k]) ? routes[k] : "";
      await api(`/api/worlds/${world.world_id}`, {
        method: "PATCH",
        body: { discord_webhooks: { hooks: cleanedHooks, routes: cleanedRoutes } },
      });
      toast(t("discord.saved"), "success");
      onChange?.();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const hookById = (id) => hooks.find((h) => h.id === id);

  return (
    <div style={{ display: "grid", gap: "1.4rem" }}>
      <section>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>{t("discord.notificationsTitle")}</h3>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.82rem", marginTop: 0, marginBottom: "0.9rem" }}>
          <Trans i18nKey="discord.notificationsDesc" components={{ b: <b /> }} />
        </p>

        {/* ---- Webhook channels ---- */}
        <label className="label">{t("discord.channels")}</label>
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {hooks.length === 0 && (
            <div className="panel-inset" style={{ padding: "0.9rem 1.1rem" }}>
              <span className="subtle" style={{ fontWeight: 600, fontSize: "0.8rem" }}>
                {t("discord.noChannels")}
              </span>
            </div>
          )}
          {hooks.map((h) => (
            <div key={h.id} className="panel-inset" style={{ padding: "0.7rem 0.9rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input
                className="input" value={h.name} onChange={(e) => patchHook(h.id, { name: e.target.value })}
                placeholder={t("discord.channelNamePlaceholder")} style={{ width: 150 }} aria-label={t("discord.channelNamePlaceholder")} />
              <input
                className="input" value={h.url} onChange={(e) => patchHook(h.id, { url: e.target.value })}
                placeholder="https://discord.com/api/webhooks/…" style={{ flex: 1, minWidth: 240 }} aria-label={t("discord.webhookUrl")} />
              <button className="btn btn-ghost" style={{ padding: "0.4rem 0.7rem" }}
                onClick={() => sendTest(h)} disabled={testingId === h.id || !h.url.trim()}>
                {testingId === h.id ? t("discord.sending") : t("discord.test")}
              </button>
              <button className="btn btn-danger" style={{ padding: "0.4rem 0.55rem" }}
                onClick={() => removeHook(h.id)} title={t("discord.removeChannel")} aria-label={t("discord.removeChannel")}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
        <button className="btn btn-ghost" style={{ marginTop: "0.6rem", padding: "0.4rem 0.8rem" }}
          onClick={addHook} disabled={hooks.length >= MAX_HOOKS}>
          <Icon name="plus" size={15} /> {t("discord.addChannel")}
        </button>
        {hooks.length >= MAX_HOOKS && (
          <span className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem", marginLeft: 8 }}>{t("discord.maxChannels", { max: MAX_HOOKS })}</span>
        )}
      </section>

      {/* ---- Per-event routing ---- */}
      <section>
        <label className="label">{t("discord.routeEvents")}</label>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", marginTop: 0, marginBottom: "0.7rem" }}>
          <Trans i18nKey="discord.routeDesc" components={{ b: <b /> }} />
        </p>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          {ROUTE_KINDS.map((k) => {
            const routed = routes[k];
            const missingUrl = routed && !(hookById(routed)?.url || "").trim();
            const kindLabel = t(`discord.kind.${k}`);
            return (
              <div key={k} className="panel-inset" style={{ padding: "0.55rem 0.9rem", display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                <div style={{ minWidth: 150, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.84rem" }}>{kindLabel}</div>
                  {k === "chat" && (
                    <div className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem" }}>
                      <Trans i18nKey="discord.chatNeedsMod" components={{ b: <b /> }} />
                    </div>
                  )}
                  {missingUrl && (
                    <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: "0.72rem" }}>
                      {t("discord.channelNoUrl")}
                    </div>
                  )}
                </div>
                <select className="input" style={{ width: 200 }} value={routed}
                  onChange={(e) => setRoute(k, e.target.value)} aria-label={t("discord.channelForAria", { event: kindLabel })}>
                  <option value="">{t("discord.dontSend")}</option>
                  {hooks.map((h) => (
                    <option key={h.id} value={h.id}>{h.name.trim() || t("discord.webhookFallback")}</option>
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
          {dirty ? t("discord.unsavedChanges") : t("discord.allSaved")}
        </span>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-ghost" onClick={discard} disabled={!dirty || saving}>{t("discord.discard")}</button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
            <Icon name="download" size={16} /> {saving ? t("discord.saving") : t("discord.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}
