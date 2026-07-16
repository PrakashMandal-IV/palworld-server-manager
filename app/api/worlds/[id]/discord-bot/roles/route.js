import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const bot = require("@/lib/discordbot");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The roles of the linked Discord server, so the allowlist can be a list of checkboxes
// instead of asking people to paste snowflakes.
//
// Reading roles needs only the bot token — no privileged intent — which is why members
// are NOT offered the same way: listing them would need GUILD_MEMBERS, and making
// users flip on a privileged intent to pick teammates isn't worth it. Individual
// people are added by id instead.
export async function GET(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const cfg = bot.readConfig(params.id);
  if (!cfg.token || !cfg.guildId) return NextResponse.json({ ok: true, roles: [] });

  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${cfg.guildId}/roles`, {
      headers: { Authorization: `Bot ${cfg.token}` },
    });
    if (!res.ok) return NextResponse.json({ ok: true, roles: [], error: `Discord returned ${res.status}` });
    const roles = await res.json();
    return NextResponse.json({
      ok: true,
      roles: (Array.isArray(roles) ? roles : [])
        // @everyone is the guild id itself and would mean "the whole server", which is
        // the one thing the allowlist exists to prevent. Managed roles belong to other
        // bots and integrations, so they're no use here either.
        .filter((r) => r && r.id !== cfg.guildId && !r.managed)
        .map((r) => ({ id: String(r.id), name: String(r.name || ""), color: r.color || 0 }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    return NextResponse.json({ ok: true, roles: [], error: e.message });
  }
}
