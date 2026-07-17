import { NextResponse } from "next/server";
const fs = require("fs");
const dbm = require("@/lib/db");
const sup = require("@/lib/supervisor");
const rest = require("@/lib/restclient");
const ini = require("@/lib/ini");
const steam = require("@/lib/steamcmd");
const { conflictsInRegistry } = require("@/lib/ports");
const guard = require("@/lib/installdir");
const trash = require("@/lib/trash");
const { boot } = require("@/lib/bootstrap");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req, { params }) {
  boot(); // make sure the background presence poller (join/leave) is running
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
    // Session join/leave is tracked by the background presence poller
    // (lib/presence.js), so it fires even when this page isn't open — no
    // inline diff here (a second diff would double-count against the poller).
  }
  const events = dbm.listEvents(w.world_id, 40);
  const sessions = dbm.listSessions(w.world_id, 30);
  const schedules = dbm.listSchedules(w.world_id);
  const backups = dbm.listBackups(w.world_id);
  // The header's update chip and button key off this. It was never sent here, so the
  // chip could not render on the detail page no matter what Steam reported.
  const updateState = steam.updateStateOf(w);
  return NextResponse.json({
    ok: true,
    world: { ...w, running, updateState, updateAvailable: updateState === "available" },
    live: { info, players, metrics, settings },
    events, sessions, schedules, backups,
  });
}

export async function PATCH(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const patch = await req.json();

  // Changing the install folder is special: validate it points at a real Palworld
  // server, refuse while running, and rebase this world's build id onto the new path.
  if ("install_dir" in patch && String(patch.install_dir).trim() !== w.install_dir) {
    if (sup.isRunning(w.world_id) || sup.pidAlive(w.process_id)) {
      return NextResponse.json({ ok: false, error: "Stop the world before changing its install folder." }, { status: 409 });
    }
    const detect = require("@/lib/detect");
    const info = detect.inspect(String(patch.install_dir).trim());
    if (!info.valid) {
      return NextResponse.json({ ok: false, error: info.reason || "Not a valid Palworld server install." }, { status: 400 });
    }
    const bad = guard.unusableTargetReason(info.installDir, { worlds: dbm.listWorlds(), selfWorldId: params.id });
    if (bad) return NextResponse.json({ ok: false, error: bad }, { status: 409 });
    const rebased = dbm.updateWorld(params.id, {
      install_dir: info.installDir,
      build_id: info.buildId || null,
    });
    // re-apply this world's ports/password into the newly pointed install
    try { ini.applyWorldNetworkSettings(info.installDir, rebased, { syncPublicPort: true }); } catch {}
    dbm.logEvent(params.id, "settings", `Install folder changed to ${info.installDir}`);
  }

  const allowed = ["display_name", "admin_password", "server_password", "autostart", "crash_guard", "rest_api_enabled", "extra_args", "game_port", "query_port", "rest_api_port", "rcon_port", "community_server", "mods_enabled", "discord_webhook", "notify_events", "discord_relay_chat", "discord_webhooks", "warn_enabled", "warn_lead_minutes", "warn_interval_minutes", "warn_message", "legacy_perf_flags"];
  const clean = {};
  for (const k of allowed) if (k in patch) clean[k] = patch[k];
  // notify_events is stored as a JSON string column; accept an object from the client.
  if (clean.notify_events && typeof clean.notify_events === "object") {
    clean.notify_events = JSON.stringify(clean.notify_events);
  }
  // discord_webhooks (the multi-webhook routing config) is likewise a JSON column.
  if (clean.discord_webhooks && typeof clean.discord_webhooks === "object") {
    clean.discord_webhooks = JSON.stringify(clean.discord_webhooks);
  }
  if ("discord_relay_chat" in clean) clean.discord_relay_chat = clean.discord_relay_chat ? 1 : 0;
  if ("warn_enabled" in clean) clean.warn_enabled = clean.warn_enabled ? 1 : 0;
  if ("legacy_perf_flags" in clean) clean.legacy_perf_flags = clean.legacy_perf_flags ? 1 : 0;
  for (const k of ["warn_lead_minutes", "warn_interval_minutes"]) {
    if (k in clean) clean[k] = Math.max(0, parseInt(clean[k], 10) || 0);
  }

  // Port fields: validate range and reject collisions with another world's ports
  // before writing anything (previously these were accepted silently, so two worlds
  // could end up sharing a port with no warning).
  const PORT_FIELDS = ["game_port", "query_port", "rest_api_port", "rcon_port"];
  if (PORT_FIELDS.some((k) => k in clean)) {
    for (const k of PORT_FIELDS) {
      if (k in clean) {
        const n = parseInt(clean[k], 10);
        if (!Number.isInteger(n) || n < 1 || n > 65535) {
          return NextResponse.json({ ok: false, error: `Invalid ${k}: must be a port number between 1 and 65535.` }, { status: 400 });
        }
        clean[k] = n;
      }
    }
    const check = { game_port: clean.game_port ?? w.game_port, query_port: clean.query_port ?? w.query_port, rest_api_port: clean.rest_api_port ?? w.rest_api_port, rcon_port: clean.rcon_port ?? w.rcon_port };
    const seen = new Set();
    for (const [label, p] of Object.entries(check)) {
      if (seen.has(p)) return NextResponse.json({ ok: false, error: `Port ${p} is used by more than one field on this world — each port must be unique.` }, { status: 400 });
      seen.add(p);
    }
    const conflicts = conflictsInRegistry(check, params.id);
    if (conflicts.length) {
      return NextResponse.json({ ok: false, error: `Port ${conflicts[0].port} is already used by "${conflicts[0].usedBy}".` }, { status: 409 });
    }
    if (sup.isRunning(w.world_id) || sup.pidAlive(w.process_id)) {
      return NextResponse.json({ ok: false, error: "Stop the world before changing its ports." }, { status: 409 });
    }
  }

  const updated = dbm.updateWorld(params.id, clean);
  // if network fields changed and install exists, re-apply ini. Only re-sync the
  // advertised PublicPort when the game port itself changed, so a routine profile
  // save doesn't overwrite a custom tunnel port set in Server Identity.
  if (fs.existsSync(updated.install_dir)) {
    try { ini.applyWorldNetworkSettings(updated.install_dir, updated, { syncPublicPort: "game_port" in clean }); } catch {}
  }
  return NextResponse.json({ ok: true, world: updated });
}

export async function DELETE(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const deleteFiles = new URL(req.url).searchParams.get("files") === "1";

  // Check before stopping anything: this folder is about to be rm -rf'd, and a world
  // whose install_dir sits above another world's would take that one with it (#9).
  if (deleteFiles && fs.existsSync(w.install_dir)) {
    let backupsPath = null;
    try { backupsPath = require("@/lib/backups").backupInfo().path; } catch {}
    const reason = guard.unsafeToDeleteReason(w.install_dir, {
      worlds: dbm.listWorlds(),
      selfWorldId: w.world_id,
      extraProtected: backupsPath ? [backupsPath] : [],
    });
    if (reason) {
      return NextResponse.json({
        ok: false,
        error: `Refusing to delete ${w.install_dir} because ${reason}. Delete the profile only, then remove the folder yourself if you're sure.`,
      }, { status: 409 });
    }
  }

  if (sup.isRunning(w.world_id)) await sup.stopWorld(w.world_id, { graceful: false });
  if (deleteFiles && fs.existsSync(w.install_dir)) {
    // Move the folder to the Recycle Bin / Trash rather than erasing it, so even a
    // wrong call is recoverable. Report a failed delete instead of swallowing it —
    // the profile used to vanish while the files stayed, with no way to retry — and
    // never fall back to a permanent delete on failure.
    try { trash.trashPath(w.install_dir); }
    catch (e) {
      return NextResponse.json({ ok: false, error: `Could not move ${w.install_dir} to the Recycle Bin: ${e.message}` }, { status: 500 });
    }
  }
  dbm.deleteWorld(params.id);
  return NextResponse.json({ ok: true });
}
