import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const bot = require("@/lib/discordbot");
const cfgLib = require("@/lib/discord-bot-config");
const { boot } = require("@/lib/bootstrap");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET: everything the UI needs, minus the token. publicConfig() is the only shape that
// ever crosses this line — the token goes in and never comes back out.
export async function GET(_req, { params }) {
  boot();
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // Self-heal: a bot that's switched on but not connected should come back by itself.
  // boot() only sweeps once per server start, so a token that arrives later — or a
  // connection that died for good — would otherwise stay down until the app restarted,
  // showing Offline in Discord with no way to fix it from here. startBot no-ops when
  // the same token is already connected, so this is safe to reach on every poll.
  const cfg = bot.readConfig(params.id);
  if (cfg.enabled && cfg.token && !bot.botStatus(params.id).connected) {
    bot.startBot(params.id).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    config: cfgLib.publicConfig(w),
    status: bot.botStatus(params.id),
  });
}

// POST: save a token, toggle the bot, or edit the allowlist.
export async function POST(req, { params }) {
  boot();
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const body = await req.json();

  // --- token ---
  if (typeof body.token === "string" && body.token.trim()) {
    const token = body.token.trim();
    // Check it with Discord before storing: a bad token would otherwise sit there
    // failing to connect with nothing to explain why. This also tells us the
    // application id, which is what the invite link needs.
    const check = await bot.validateToken(token);
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 });

    const prev = bot.readConfig(params.id);
    bot.writeConfig(params.id, {
      token,
      appId: check.appId,
      botUsername: check.username,
      enabled: true,
      // A different bot means the old link is meaningless — make them re-authorize
      // rather than silently handing a new bot the old server's permissions.
      ...(prev.appId && prev.appId !== check.appId
        ? { guildId: "", guildName: "", authorizedAt: 0, authorizedBy: "", allowedRoles: [], allowedUsers: [] }
        : {}),
    });
    await bot.startBot(params.id);
    return NextResponse.json({ ok: true, config: cfgLib.publicConfig(dbm.getWorld(params.id)), status: bot.botStatus(params.id) });
  }

  // --- enable / disable ---
  if (typeof body.enabled === "boolean") {
    bot.writeConfig(params.id, { enabled: body.enabled });
    if (body.enabled) await bot.startBot(params.id);
    else await bot.stopBot(params.id);
  }

  // --- permissions: one cell of the grid ---
  // { grant: { action, type: "role"|"user", id, on } }
  if (body.grant && typeof body.grant === "object") {
    const { action, type, id, on } = body.grant;
    const cur = bot.readConfig(params.id);
    const next = cfgLib.setGrant(cur.permissions, String(action), type === "role" ? "role" : "user", String(id), on === true);
    bot.writeConfig(params.id, { permissions: next });
  }

  // --- permissions: add or remove a subject entirely ---
  // { subject: { type, id, grant: true|false } } — adding means every action, which is
  // what "let this person use the bot" means before anyone narrows it down.
  if (body.subject && typeof body.subject === "object") {
    const { type, id, grant } = body.subject;
    const cur = bot.readConfig(params.id);
    const kind = type === "role" ? "role" : "user";
    const next = grant === false
      ? cfgLib.revokeAll(cur.permissions, kind, String(id))
      : cfgLib.grantAll(cur.permissions, kind, String(id));
    bot.writeConfig(params.id, { permissions: next });
  }

  // --- what /status puts on its card ---
  // { statusField: { field, on } } — one switch at a time, and an unknown field is
  // ignored rather than stored, so the saved shape can only ever hold real ones.
  if (body.statusField && typeof body.statusField === "object") {
    const { field, on } = body.statusField;
    if (cfgLib.STATUS_FIELDS.includes(field)) {
      const cur = bot.readConfig(params.id);
      bot.writeConfig(params.id, { statusFields: { ...cur.statusFields, [field]: on === true } });
    }
  }

  // --- unlink the guild, keep the bot ---
  if (body.unlink === true) {
    bot.writeConfig(params.id, { guildId: "", guildName: "", authorizedAt: 0, authorizedBy: "", allowedRoles: [], allowedUsers: [] });
  }

  return NextResponse.json({ ok: true, config: cfgLib.publicConfig(dbm.getWorld(params.id)), status: bot.botStatus(params.id) });
}

// DELETE: forget the bot entirely, token included.
export async function DELETE(_req, { params }) {
  boot();
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  await bot.stopBot(params.id);
  dbm.updateWorld(params.id, { discord_bot: null });
  return NextResponse.json({ ok: true });
}
