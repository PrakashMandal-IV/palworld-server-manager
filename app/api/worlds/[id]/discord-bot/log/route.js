import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const cfgLib = require("@/lib/discord-bot-config");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Everything anyone has done through the bot, filtered.
//
//   ?from=<ms>&to=<ms>&user=<id>&action=<name>&result=ok|denied|error&limit=<n>
//
// Filters stack and every one is optional. `actors` comes back alongside so the UI can
// offer a real list of people to filter by instead of asking for an id, and it's built
// from the log itself — someone who has since lost access still appears in their own
// history.
export async function GET(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const q = new URL(req.url).searchParams;
  const action = q.get("action") || "";
  const entries = dbm.listDiscordActions(params.id, {
    from: q.get("from") || undefined,
    to: q.get("to") || undefined,
    userId: q.get("user") || undefined,
    // Ignore an action we don't know: a typo should show everything rather than
    // silently return nothing and look like "no history".
    action: cfgLib.ACTIONS.includes(action) || action === "authorize" ? action : undefined,
    result: ["ok", "denied", "error"].includes(q.get("result")) ? q.get("result") : undefined,
    limit: q.get("limit") || 200,
  });

  return NextResponse.json({
    ok: true,
    entries,
    actors: dbm.listDiscordActors(params.id),
    // authorize isn't a grantable action, but it is a thing that happened, so it has
    // to be filterable.
    actions: [...cfgLib.ACTIONS, "authorize"],
  });
}
