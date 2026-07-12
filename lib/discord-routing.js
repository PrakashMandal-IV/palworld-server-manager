// lib/discord-routing.js
// Pure, isomorphic helpers for per-world Discord webhook routing. Shared by the
// server (notify.js, supervisor.js) and the Discord settings UI, so it must use NO
// node builtins — it gets bundled into the client too.
//
// A world can define several named webhook "channels" and route each event kind to
// one of them (or to none). The config is stored as JSON in worlds.discord_webhooks:
//   { hooks: [{ id, name, url }], routes: { start: id, ..., chat: id } }
// where a route value of "" means "don't send that event".

// Events that flow through notify(): the server-status lifecycle plus backups.
const EVENT_KINDS = ["start", "stop", "restart", "crash", "backup", "update"];
// "chat" is the in-game chat relay, routed the same way but delivered separately.
const ROUTE_KINDS = [...EVENT_KINDS, "chat"];
const MAX_HOOKS = 10;

function parseJsonish(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

// Build a sanitized { hooks, routes } for a world. When the new multi-webhook config
// hasn't been saved yet, synthesize an equivalent one from the legacy single-webhook
// fields (discord_webhook + notify_events + discord_relay_chat) so existing setups
// behave exactly as before.
function normalizeDiscord(world) {
  const cfg = parseJsonish(world && world.discord_webhooks);
  if (cfg && Array.isArray(cfg.hooks) && cfg.hooks.length) {
    const hooks = [];
    const seen = new Set();
    for (const h of cfg.hooks.slice(0, MAX_HOOKS)) {
      if (!h || typeof h !== "object") continue;
      const id = String(h.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      hooks.push({
        id,
        name: String(h.name || "").trim() || "Webhook",
        url: String(h.url || "").trim(),
      });
    }
    const validIds = new Set(hooks.map((h) => h.id));
    const src = (cfg.routes && typeof cfg.routes === "object") ? cfg.routes : {};
    const routes = {};
    for (const k of ROUTE_KINDS) {
      const v = String(src[k] || "").trim();
      routes[k] = validIds.has(v) ? v : "";
    }
    return { hooks, routes };
  }

  // ---- legacy fallback: one "Default Channel" from the old single webhook ----
  // Mirrors the one-time DB backfill so a world that somehow still lacks the saved
  // config behaves identically: every event routed to the single webhook, and chat
  // only if the relay was on.
  const url = String((world && world.discord_webhook) || "").trim();
  const routes = {};
  for (const k of EVENT_KINDS) routes[k] = url ? "default" : "";
  routes.chat = (url && world && world.discord_relay_chat) ? "default" : "";
  return { hooks: url ? [{ id: "default", name: "Default Channel", url }] : [], routes };
}

// Resolve the destination webhook URL for one event kind, or "" if it isn't routed
// (either the user chose "don't send", or the routed channel has no URL).
function webhookFor(world, kind) {
  const { hooks, routes } = normalizeDiscord(world);
  const id = routes[kind];
  if (!id) return "";
  const hook = hooks.find((h) => h.id === id);
  return hook ? hook.url : "";
}

module.exports = { EVENT_KINDS, ROUTE_KINDS, MAX_HOOKS, normalizeDiscord, webhookFor };
