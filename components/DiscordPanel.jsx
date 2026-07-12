"use client";
import { useMemo, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";

const EVENT_KINDS = ["start", "stop", "restart", "crash", "backup", "update"];

function parseNotifyEvents(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

export default function DiscordPanel({ world, onChange }) {
  const { t } = useTranslation();
  const initial = useMemo(() => ({
    webhook: (world.discord_webhook || "").trim(),
    events: parseNotifyEvents(world.notify_events),
    relay: !!world.discord_relay_chat,
  }), [world.discord_webhook, world.notify_events, world.discord_relay_chat]);

  const [webhook, setWebhook] = useState(initial.webhook);
  const [events, setEvents] = useState(initial.events);
  const [relay, setRelay] = useState(initial.relay);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const on = (k) => events[k] !== false;
  const eventsDirty = EVENT_KINDS.some((k) => on(k) !== (initial.events[k] !== false));
  const dirty = webhook.trim() !== initial.webhook || relay !== initial.relay || eventsDirty;

  const discard = () => {
    setWebhook(initial.webhook);
    setEvents(initial.events);
    setRelay(initial.relay);
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await api("/api/settings/test-notify", { method: "POST", body: { webhook: webhook.trim() } });
      toast(t("discord.testSent"), "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setTesting(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/worlds/${world.world_id}`, {
        method: "PATCH",
        body: { discord_webhook: webhook.trim(), notify_events: events, discord_relay_chat: relay ? 1 : 0 },
      });
      toast(t("discord.saved"), "success");
      onChange?.();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: "grid", gap: "1.4rem" }}>
      <section>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>{t("discord.notificationsTitle")}</h3>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.82rem", marginTop: 0, marginBottom: "0.8rem" }}>
          {t("discord.notificationsDesc")}
        </p>

        <label className="label">{t("discord.webhookUrl")}</label>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.1rem", flexWrap: "wrap" }}>
          <input className="input" style={{ flex: 1, minWidth: 260 }} value={webhook}
            onChange={(e) => setWebhook(e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
          <button className="btn btn-ghost" onClick={sendTest} disabled={testing || !webhook.trim()}>
            {testing ? t("discord.sending") : t("discord.sendTest")}
          </button>
        </div>

        <label className="label">{t("discord.notifyOn")}</label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {EVENT_KINDS.map((k) => (
            <button key={k} className={`btn ${on(k) ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.35rem 0.7rem" }}
              onClick={() => setEvents((prev) => ({ ...prev, [k]: !(prev[k] !== false) }))}>
              {t(`discord.event.${k}`)}
            </button>
          ))}
        </div>

        <div className="panel-inset" style={{ padding: "0.9rem 1.1rem", marginTop: "1.1rem", borderLeft: `3px solid ${relay ? "var(--green-bright)" : "var(--line-strong)"}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ minWidth: 240, flex: 1 }}>
              <div className="heading" style={{ fontSize: "0.92rem" }}>{t("discord.relayTitle")}</div>
              <div className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", marginTop: 2 }}>
                <Trans i18nKey="discord.relayDesc" components={{ b: <b /> }} />
              </div>
            </div>
            <button className={`btn ${relay ? "btn-primary" : "btn-ghost"}`} onClick={() => setRelay((v) => !v)}>
              <span className="statdot" style={{ background: relay ? "var(--accent-ink)" : "var(--ink-soft)" }} /> {relay ? t("common.on") : t("common.off")}
            </button>
          </div>
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
