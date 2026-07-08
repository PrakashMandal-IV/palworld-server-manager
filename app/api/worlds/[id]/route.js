import { NextResponse } from "next/server";
const fs = require("fs");
const dbm = require("@/lib/db");
const sup = require("@/lib/supervisor");
const rest = require("@/lib/restclient");
const ini = require("@/lib/ini");
const steam = require("@/lib/steamcmd");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req, { params }) {
  let w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (!w.build_id) {
    try {
      const bid = steam.readInstalledBuildId(w.install_dir);
      if (bid) w = dbm.updateWorld(params.id, { build_id: bid });
    } catch {}
  }
  const running = sup.isRunning(w.world_id) || sup.pidAlive(w.process_id);
  let info = null, players = null, metrics = null, settings = null;
  if (running && w.rest_api_enabled) {
    [info, players, metrics, settings] = await Promise.all([
      rest.info(w).catch(() => null),
      rest.players(w).catch(() => null),
      rest.metrics(w).catch(() => null),
      rest.settings(w).catch(() => null),
    ]);
    // session diff (join/leave) — persist events
    try { diffSessions(w.world_id, players?.players || []); } catch {}
  }
  const events = dbm.listEvents(w.world_id, 40);
  const sessions = dbm.listSessions(w.world_id, 30);
  const schedules = dbm.listSchedules(w.world_id);
  const backups = dbm.listBackups(w.world_id);
  return NextResponse.json({
    ok: true,
    world: { ...w, running },
    live: { info, players, metrics, settings },
    events, sessions, schedules, backups,
  });
}

export async function PATCH(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const patch = await req.json();
  const allowed = ["display_name", "admin_password", "autostart", "crash_guard", "rest_api_enabled", "extra_args", "game_port", "query_port", "rest_api_port", "rcon_port", "community_server", "mods_enabled"];
  const clean = {};
  for (const k of allowed) if (k in patch) clean[k] = patch[k];
  const updated = dbm.updateWorld(params.id, clean);
  // if network fields changed and install exists, re-apply ini
  if (fs.existsSync(updated.install_dir)) {
    try { ini.applyWorldNetworkSettings(updated.install_dir, updated); } catch {}
  }
  return NextResponse.json({ ok: true, world: updated });
}

export async function DELETE(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const deleteFiles = new URL(req.url).searchParams.get("files") === "1";
  if (sup.isRunning(w.world_id)) await sup.stopWorld(w.world_id, { graceful: false });
  if (deleteFiles && fs.existsSync(w.install_dir)) {
    try { fs.rmSync(w.install_dir, { recursive: true, force: true }); } catch {}
  }
  dbm.deleteWorld(params.id);
  return NextResponse.json({ ok: true });
}

// diff consecutive player polls to record join/leave (spec §5)
const g = globalThis;
if (!g.__PAL_LASTPLAYERS) g.__PAL_LASTPLAYERS = new Map();
function diffSessions(worldId, players) {
  const now = new Map(players.map((p) => [p.userId || p.playerId || p.name, p.name]));
  const prev = g.__PAL_LASTPLAYERS.get(worldId) || new Map();
  for (const [uid, name] of now) if (!prev.has(uid)) dbm.logSession(worldId, uid, name, "join");
  for (const [uid, name] of prev) if (!now.has(uid)) dbm.logSession(worldId, uid, name, "leave");
  g.__PAL_LASTPLAYERS.set(worldId, now);
}
