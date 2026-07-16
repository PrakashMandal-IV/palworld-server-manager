import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const bot = require("@/lib/discordbot");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API = "https://discord.com/api/v10";
const CDN = "https://cdn.discordapp.com";

// Discord's fallback avatars. Modern accounts index by (id >> 22) % 6; the old
// discriminator scheme is still around on unmigrated accounts.
function defaultAvatar(user) {
  if (user.discriminator && user.discriminator !== "0") {
    return `${CDN}/embed/avatars/${Number(user.discriminator) % 5}.png`;
  }
  try { return `${CDN}/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`; }
  catch { return `${CDN}/embed/avatars/0.png`; }
}

// Roles and members of the linked server, for picking the allowlist.
//
// Roles need nothing but the bot token. Members are different: GET /guilds/:id/members
// requires the SERVER MEMBERS privileged intent, and without it Discord answers 403
// Missing Access. That's a switch only the bot's owner can flip in the developer
// portal, so we report it as a state rather than an error and let the UI explain it —
// the paste-an-id path keeps working either way.
export async function GET(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const cfg = bot.readConfig(params.id);
  if (!cfg.token || !cfg.guildId) return NextResponse.json({ ok: true, roles: [], members: [], membersNeedIntent: false });

  const headers = { Authorization: `Bot ${cfg.token}` };
  const out = { ok: true, roles: [], members: [], membersNeedIntent: false };

  // ---- roles ----
  try {
    const res = await fetch(`${API}/guilds/${cfg.guildId}/roles`, { headers });
    if (res.ok) {
      const roles = await res.json();
      out.roles = (Array.isArray(roles) ? roles : [])
        // @everyone is the guild id and means "the whole server" — the one thing an
        // allowlist exists to prevent. Managed roles are owned by other bots and
        // integrations and can't be handed to a person, so they're no use here.
        .filter((r) => r && r.id !== cfg.guildId && !r.managed)
        // Discord orders roles by position, highest first. Mirror that so the list
        // reads the same as the one in Discord's own settings.
        .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name))
        .map((r) => ({
          id: String(r.id),
          name: String(r.name || ""),
          position: r.position,
          color: r.color ? `#${r.color.toString(16).padStart(6, "0")}` : null,
          iconUrl: r.icon ? `${CDN}/role-icons/${r.id}/${r.icon}.png?size=32` : null,
          emoji: r.unicode_emoji || null,
        }));
    } else out.rolesError = `Discord returned ${res.status}`;
  } catch (e) { out.rolesError = e.message; }

  // ---- members ----
  try {
    const res = await fetch(`${API}/guilds/${cfg.guildId}/members?limit=200`, { headers });
    if (res.status === 403) {
      out.membersNeedIntent = true; // Server Members intent is off in the portal
    } else if (res.ok) {
      const members = await res.json();
      out.members = (Array.isArray(members) ? members : [])
        .filter((m) => m && m.user && !m.user.bot)
        .map((m) => ({
          id: String(m.user.id),
          username: String(m.user.username || ""),
          // What Discord shows in the member list: server nickname first, then the
          // account's display name, then the raw username.
          displayName: String(m.nick || m.user.global_name || m.user.username || ""),
          avatarUrl: m.user.avatar ? `${CDN}/avatars/${m.user.id}/${m.user.avatar}.png?size=64` : defaultAvatar(m.user),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    } else out.membersError = `Discord returned ${res.status}`;
  } catch (e) { out.membersError = e.message; }

  return NextResponse.json(out);
}
