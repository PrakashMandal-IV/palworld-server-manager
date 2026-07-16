// lib/discord-bot-config.js
// Pure helpers for a world's Discord bot config. Shared by the server (discordbot.js,
// API routes) and the Discord Bot settings UI, so it must use NO node builtins — it
// gets bundled into the client too.
//
// Stored as JSON in worlds.discord_bot:
//   {
//     enabled, token, appId, botUsername,
//     guildId, guildName, authorizedAt, authorizedBy,   // set by /authorize
//     allowedRoles: [], allowedUsers: []
//   }
//
// The token is the one field that must never leave the server — publicConfig() is the
// only shape the UI is ever given.

const MAX_ROLES = 25;
const MAX_USERS = 25;

// Every command the bot exposes. `admin` commands need the allowlist; /authorize is
// the way in, so it can't.
const COMMANDS = [
  { name: "authorize", admin: false },
  { name: "start", admin: true },
  { name: "stop", admin: true },
  { name: "restart", admin: true },
  { name: "broadcast", admin: true },
  { name: "backup", admin: true },
];

function parseJsonish(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

function idList(v, max) {
  if (!Array.isArray(v)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of v) {
    // Discord snowflakes are numeric strings; reject anything else outright rather
    // than storing junk that could never match an id anyway.
    const id = String(raw || "").trim();
    if (!/^\d{5,25}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

// Read a world's bot config into a predictable shape. Never throws; a world with no
// bot set up comes back as a disabled, tokenless config.
function normalizeBotConfig(world) {
  const c = parseJsonish(world && world.discord_bot) || {};
  return {
    enabled: c.enabled === true,
    token: typeof c.token === "string" ? c.token : "",
    appId: String(c.appId || ""),
    botUsername: String(c.botUsername || ""),
    guildId: String(c.guildId || ""),
    guildName: String(c.guildName || ""),
    authorizedAt: Number(c.authorizedAt) || 0,
    authorizedBy: String(c.authorizedBy || ""),
    allowedRoles: idList(c.allowedRoles, MAX_ROLES),
    allowedUsers: idList(c.allowedUsers, MAX_USERS),
  };
}

// Show enough of the token to recognise it, never enough to use it.
function maskToken(token) {
  const t = String(token || "");
  if (!t) return "";
  return `${"•".repeat(12)}${t.slice(-4)}`;
}

// The only shape the browser ever sees: no token, ever.
function publicConfig(world) {
  const c = normalizeBotConfig(world);
  return {
    enabled: c.enabled,
    hasToken: !!c.token,
    tokenHint: maskToken(c.token),
    appId: c.appId,
    botUsername: c.botUsername,
    guildId: c.guildId,
    guildName: c.guildName,
    authorized: !!(c.guildId && c.authorizedAt),
    authorizedAt: c.authorizedAt,
    authorizedBy: c.authorizedBy,
    allowedRoles: c.allowedRoles,
    allowedUsers: c.allowedUsers,
    inviteUrl: c.appId ? inviteUrl(c.appId) : "",
  };
}

// The invite the user hands to their server. permissions=0 on purpose: the bot only
// ever answers interactions, so it needs no channel powers at all — least privilege,
// and it makes the "add to server" screen ask for nothing scary.
// applications.commands is what allows slash commands; bot is what makes it a member.
function inviteUrl(appId) {
  const p = new URLSearchParams({
    client_id: String(appId),
    scope: "bot applications.commands",
    permissions: "0",
  });
  return `https://discord.com/oauth2/authorize?${p.toString()}`;
}

// Who may run the admin commands. Deliberately a closed list: no roles and no users
// means nobody, rather than everybody. /authorize adds whoever proved they know the
// admin password, so a fresh setup is usable without being open to the whole server.
function isAllowed(cfg, userId, roleIds) {
  if (!cfg) return false;
  if (cfg.allowedUsers.includes(String(userId))) return true;
  const roles = Array.isArray(roleIds) ? roleIds.map(String) : [];
  return cfg.allowedRoles.some((r) => roles.includes(r));
}

module.exports = {
  COMMANDS, MAX_ROLES, MAX_USERS,
  normalizeBotConfig, publicConfig, maskToken, inviteUrl, isAllowed,
};
