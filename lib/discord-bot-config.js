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

// Everything a Discord user can be granted, and the single place to add more. A new
// action needs an entry here, a branch in discordbot.runCommand, and a command
// definition — the permission grid, the audit log filter and the migration all read
// this list rather than hard-coding names.
const ACTIONS = ["start", "stop", "restart", "broadcast", "backup"];

// Every command the bot exposes. `admin` commands are permission-checked per action;
// /authorize is the way in, so it can't be.
const COMMANDS = [
  { name: "authorize", admin: false },
  ...ACTIONS.map((name) => ({ name, admin: true })),
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

// Who may run what, as { start: { roles: [], users: [] }, ... } — one entry per action.
//
// Setups made before per-action grants existed only had a flat allowlist, where being
// on it meant being able to do everything. Those configs are migrated on read rather
// than in a DB step: absent `permissions` plus a non-empty legacy list means grant that
// list every action, which is exactly what it could do yesterday. Nobody silently gains
// or loses anything.
function normalizePermissions(c) {
  const src = c && c.permissions && typeof c.permissions === "object" ? c.permissions : null;
  const perms = {};
  for (const a of ACTIONS) {
    const p = src ? src[a] : null;
    perms[a] = {
      roles: idList(p && p.roles, MAX_ROLES),
      users: idList(p && p.users, MAX_USERS),
    };
  }
  if (!src) {
    const roles = idList(c && c.allowedRoles, MAX_ROLES);
    const users = idList(c && c.allowedUsers, MAX_USERS);
    if (roles.length || users.length) {
      for (const a of ACTIONS) perms[a] = { roles: [...roles], users: [...users] };
    }
  }
  return perms;
}

// Everyone who appears anywhere in the grid, so the UI can list subjects once and
// hang the per-action toggles off them.
function subjects(perms) {
  const roles = new Set();
  const users = new Set();
  for (const a of ACTIONS) {
    for (const r of perms[a].roles) roles.add(r);
    for (const u of perms[a].users) users.add(u);
  }
  return { roles: [...roles], users: [...users] };
}

// Read a world's bot config into a predictable shape. Never throws; a world with no
// bot set up comes back as a disabled, tokenless config.
function normalizeBotConfig(world) {
  const c = parseJsonish(world && world.discord_bot) || {};
  const permissions = normalizePermissions(c);
  const subs = subjects(permissions);
  return {
    enabled: c.enabled === true,
    token: typeof c.token === "string" ? c.token : "",
    appId: String(c.appId || ""),
    botUsername: String(c.botUsername || ""),
    guildId: String(c.guildId || ""),
    guildName: String(c.guildName || ""),
    authorizedAt: Number(c.authorizedAt) || 0,
    authorizedBy: String(c.authorizedBy || ""),
    permissions,
    // Derived: everyone with at least one grant. Kept under the old names so callers
    // that only care "is this person known at all" keep reading naturally.
    allowedRoles: subs.roles,
    allowedUsers: subs.users,
  };
}

// Grant every action to a subject — what "add this person" means, and what the
// authorizing user gets so linking never leaves the bot unusable.
function grantAll(perms, type, id) {
  const next = {};
  const key = type === "role" ? "roles" : "users";
  for (const a of ACTIONS) {
    const cur = perms[a][key];
    next[a] = { ...perms[a], [key]: cur.includes(id) ? cur : [...cur, id] };
  }
  return next;
}

// Remove a subject from every action.
function revokeAll(perms, type, id) {
  const next = {};
  const key = type === "role" ? "roles" : "users";
  for (const a of ACTIONS) next[a] = { ...perms[a], [key]: perms[a][key].filter((x) => x !== id) };
  return next;
}

// Flip one cell of the grid.
function setGrant(perms, action, type, id, on) {
  if (!ACTIONS.includes(action)) return perms;
  const key = type === "role" ? "roles" : "users";
  const cur = perms[action][key];
  const nextList = on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id);
  return { ...perms, [action]: { ...perms[action], [key]: nextList } };
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
    permissions: c.permissions,
    actions: ACTIONS,
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

// May this person run this one action? Deliberately a closed list: no roles and no
// users granted means nobody, rather than everybody. /authorize grants whoever proved
// they know the admin password, so a fresh setup is usable without being open to the
// whole server. An unknown action is refused rather than allowed by omission.
function isAllowed(cfg, action, userId, roleIds) {
  if (!cfg || !cfg.permissions) return false;
  const p = cfg.permissions[action];
  if (!p) return false;
  if (p.users.includes(String(userId))) return true;
  const roles = Array.isArray(roleIds) ? roleIds.map(String) : [];
  return p.roles.some((r) => roles.includes(r));
}

// Which actions this person could run, for telling someone what they *can* do when
// they hit something they can't.
function actionsFor(cfg, userId, roleIds) {
  return ACTIONS.filter((a) => isAllowed(cfg, a, userId, roleIds));
}

module.exports = {
  ACTIONS, COMMANDS, MAX_ROLES, MAX_USERS,
  normalizeBotConfig, normalizePermissions, subjects, publicConfig, maskToken, inviteUrl,
  isAllowed, actionsFor, grantAll, revokeAll, setGrant,
};
