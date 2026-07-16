// lib/db.js
// The single registry every module reads/writes through (spec §1).
// Uses better-sqlite3 (synchronous, fast, embedded).
const Database = require("./sqlite");
const { P } = require("./paths");
const os = require("os");

let _db = null;

function db() {
  if (_db) return _db;
  _db = new Database(P.db());
  _db.pragma("journal_mode = WAL");
  migrate(_db);
  return _db;
}

// Close the DB cleanly on shutdown so the WASM backend releases its lock
// directory instead of leaving a stale one behind (which would deadlock the
// next launch).
function closeDb() {
  if (_db) { try { _db.close(); } catch {} _db = null; }
}
if (!globalThis.__PAL_DB_EXIT_HOOK) {
  globalThis.__PAL_DB_EXIT_HOOK = true;
  for (const sig of ["exit", "SIGINT", "SIGTERM", "SIGHUP"]) {
    try { process.on(sig, () => { closeDb(); if (sig !== "exit") process.exit(0); }); } catch {}
  }
}

// SQLite has no "ADD COLUMN IF NOT EXISTS". Next.js prerenders multiple pages
// in parallel worker processes during `next build`, and each one independently
// opens this same file and runs migrations — so two workers can race past the
// `cols.includes()` check at the same time. This makes the ALTER itself safe
// regardless of that race, instead of relying solely on the pre-check.
function addColumnIfMissing(d, sql) {
  try {
    d.exec(sql);
  } catch (e) {
    if (!/duplicate column name/i.test(e.message)) throw e;
  }
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS worlds (
      world_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      install_dir TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'linux',   -- 'windows' | 'linux' — depot fetched by SteamCMD
      env_vars TEXT NOT NULL DEFAULT '{}',   -- JSON object of custom process env vars
      wine_binary TEXT NOT NULL DEFAULT 'wine',  -- only used when platform='windows' on a non-Windows host
      wine_prefix TEXT,                       -- custom WINEPREFIX; null = auto per-world default
      game_port INTEGER NOT NULL,
      query_port INTEGER NOT NULL,
      rest_api_port INTEGER NOT NULL,
      rcon_port INTEGER NOT NULL,
      admin_password TEXT NOT NULL DEFAULT '',
      rest_api_enabled INTEGER NOT NULL DEFAULT 1,
      rcon_enabled INTEGER NOT NULL DEFAULT 0,
      process_id INTEGER,
      status TEXT NOT NULL DEFAULT 'stopped',
      autostart INTEGER NOT NULL DEFAULT 0,
      crash_guard INTEGER NOT NULL DEFAULT 1,
      build_id TEXT,
      latest_known_build_id TEXT,
      crash_count INTEGER NOT NULL DEFAULT 0,
      extra_args TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      last_started_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT,
      kind TEXT NOT NULL,
      message TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      size_bytes INTEGER,
      reason TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      job_type TEXT NOT NULL,          -- restart | backup | update | system_message | onscreen_notice
      mode TEXT NOT NULL,              -- interval | daily | minutes | on_join
      interval_hours REAL,             -- for interval mode
      interval_minutes REAL,           -- for minutes mode
      time_of_day TEXT,                -- 'HH:MM' for daily mode
      message TEXT,                    -- text for system_message / onscreen_notice jobs
      join_match TEXT,                 -- player name to match for on_join mode (blank = anyone)
      join_delay_seconds INTEGER,      -- for on_join mode: wait this long after the join before sending
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      user_id TEXT,
      player_name TEXT,
      event TEXT NOT NULL,             -- join | leave
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS ini_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      content TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS broadcasts (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      message TEXT NOT NULL,
      fire_at INTEGER NOT NULL,     -- epoch ms when it should be broadcast
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'  -- pending | missed
    );

    CREATE TABLE IF NOT EXISTS mods (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      package_name TEXT NOT NULL,
      display_name TEXT,
      workshop_id TEXT,
      version TEXT,
      source TEXT,               -- workshop | manual | local
      folder TEXT,               -- folder name under Mods/Workshop
      is_server INTEGER DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
  `);

  // ---- lightweight migrations for databases created before newer columns ----
  const cols = d.prepare("PRAGMA table_info(worlds)").all().map((c) => c.name);
  if (!cols.includes("rcon_enabled")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN rcon_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.includes("mods_enabled")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN mods_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.includes("icon_data")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN icon_data TEXT");   // data URL (small)
  }
  if (!cols.includes("banner_data")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN banner_data TEXT"); // data URL (small)
  }
  if (!cols.includes("accent_color")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN accent_color TEXT");
  }
  if (!cols.includes("community_server")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN community_server INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.includes("platform")) {
    // Backfill existing rows with the host's own platform — they were
    // provisioned before this feature existed, so that's the correct value.
    const hostPlat = os.platform() === "win32" ? "windows" : "linux";
    addColumnIfMissing(d, `ALTER TABLE worlds ADD COLUMN platform TEXT NOT NULL DEFAULT '${hostPlat}'`);
  }
  if (!cols.includes("env_vars")) {
    addColumnIfMissing(d, `ALTER TABLE worlds ADD COLUMN env_vars TEXT NOT NULL DEFAULT '{}'`);
  }
  if (!cols.includes("wine_binary")) {
    addColumnIfMissing(d, `ALTER TABLE worlds ADD COLUMN wine_binary TEXT NOT NULL DEFAULT 'wine'`);
  }
  if (!cols.includes("wine_prefix")) {
    addColumnIfMissing(d, `ALTER TABLE worlds ADD COLUMN wine_prefix TEXT`);
  }
  // Discord webhook moved from a single global setting to per-world (v1.3.1):
  // each world carries its own webhook, notify-on events, and chat-relay flag.
  if (!cols.includes("discord_webhook")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN discord_webhook TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes("notify_events")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN notify_events TEXT"); // JSON {kind:bool}; null = all on
  }
  if (!cols.includes("discord_relay_chat")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN discord_relay_chat INTEGER NOT NULL DEFAULT 0");
  }
  // Multiple Discord webhooks with per-event routing (v2.1.0). JSON:
  // { hooks:[{id,name,url}], routes:{start:id,...,chat:id} }. Null = no channels.
  if (!cols.includes("discord_webhooks")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN discord_webhooks TEXT");
    // One-time backfill for people upgrading who were already using Discord: turn
    // their single webhook into one "Default Channel" and route their events to it,
    // so notifications keep working without reconfiguring. Chat is only routed if
    // the chat relay was already on, to preserve their exact prior behaviour. Worlds
    // with no webhook get nothing.
    //
    // An event the user had switched off in the old UI (notify_events {kind:false},
    // where missing/blank means all on) stays off. Routing everything to the webhook
    // regardless — as this did originally — silently turned those notifications back
    // on during the upgrade, with no way to tell it had happened.
    try {
      const rows = d.prepare(
        "SELECT world_id, discord_webhook, discord_relay_chat, notify_events FROM worlds WHERE discord_webhook IS NOT NULL AND discord_webhook <> ''"
      ).all();
      for (const r of rows) {
        const url = String(r.discord_webhook || "").trim();
        if (!url) continue;
        let events = {};
        try { events = (r.notify_events ? JSON.parse(r.notify_events) : null) || {}; } catch { events = {}; }
        const routes = {};
        for (const k of ["start", "stop", "restart", "crash", "backup", "update"]) {
          routes[k] = events[k] === false ? "" : "default";
        }
        routes.chat = r.discord_relay_chat ? "default" : "";
        const cfg = { hooks: [{ id: "default", name: "Default Channel", url }], routes };
        d.prepare("UPDATE worlds SET discord_webhooks=? WHERE world_id=?").run(JSON.stringify(cfg), r.world_id);
      }
    } catch { /* non-fatal — the read-time fallback still covers un-migrated worlds */ }
  }
  // The old global webhook/notify settings are gone now that it's per-world — drop the
  // stale rows so nothing keeps posting to a webhook the UI no longer surfaces.
  try {
    d.exec("DELETE FROM app_settings WHERE key IN ('discordWebhook','notifyEvents','discordRelayChat')");
  } catch {}

  // Player join password (v1.5.0). Distinct from admin_password: this is the
  // ServerPassword players type on the in-game join screen. Empty = open server.
  if (!cols.includes("server_password")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN server_password TEXT NOT NULL DEFAULT ''");
  }
  // Pre-shutdown warning countdown (v1.5.0): broadcast timed notices to players
  // before a scheduled/manual restart or update, then hand off to Palworld's
  // native red shutdown countdown.
  if (!cols.includes("warn_enabled")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN warn_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.includes("warn_lead_minutes")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN warn_lead_minutes INTEGER NOT NULL DEFAULT 10");
  }
  if (!cols.includes("warn_interval_minutes")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN warn_interval_minutes INTEGER NOT NULL DEFAULT 2");
  }
  if (!cols.includes("warn_message")) {
    addColumnIfMissing(d, "ALTER TABLE worlds ADD COLUMN warn_message TEXT NOT NULL DEFAULT 'The server will restart in {minutes} minute(s). Please get to a safe place.'");
  }

  // Scheduled-broadcast status (v1.5.0): a broadcast whose time passed while the app
  // was closed is kept and flagged 'missed' instead of firing late or vanishing.
  const bcols = d.prepare("PRAGMA table_info(broadcasts)").all().map((c) => c.name);
  if (!bcols.includes("status")) {
    addColumnIfMissing(d, "ALTER TABLE broadcasts ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
  }

  // Scheduled system messages / on-screen notices, and the minutes + on_join
  // trigger modes (v2.x): schedules gain a message, a fine-grained minutes
  // interval, and a player-name matcher for the "when a player joins" trigger.
  const scols = d.prepare("PRAGMA table_info(schedules)").all().map((c) => c.name);
  if (!scols.includes("interval_minutes")) d.exec("ALTER TABLE schedules ADD COLUMN interval_minutes REAL");
  if (!scols.includes("message")) d.exec("ALTER TABLE schedules ADD COLUMN message TEXT");
  if (!scols.includes("join_match")) d.exec("ALTER TABLE schedules ADD COLUMN join_match TEXT");
  // A pause between the join and the message (v2.3.0). Existing on_join rows stay
  // NULL, which the scheduler reads as "send immediately" — their behavior is unchanged.
  if (!scols.includes("join_delay_seconds")) d.exec("ALTER TABLE schedules ADD COLUMN join_delay_seconds INTEGER");
}

// ---- generic settings kv ----
function getSetting(key, fallback = null) {
  const row = db().prepare("SELECT value FROM app_settings WHERE key=?").get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}
function setSetting(key, value) {
  db().prepare(
    "INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(key, JSON.stringify(value));
}

// ---- worlds ----
function listWorlds() {
  return db().prepare("SELECT * FROM worlds ORDER BY created_at ASC").all();
}
function getWorld(id) {
  return db().prepare("SELECT * FROM worlds WHERE world_id=?").get(id);
}
function insertWorld(w) {
  db().prepare(`INSERT INTO worlds
    (world_id, display_name, install_dir, platform, env_vars, wine_binary, wine_prefix,
     game_port, query_port, rest_api_port, rcon_port, admin_password, rest_api_enabled,
     status, autostart, crash_guard, build_id, extra_args, created_at)
    VALUES (@world_id,@display_name,@install_dir,@platform,@env_vars,@wine_binary,@wine_prefix,
     @game_port,@query_port,@rest_api_port,@rcon_port,@admin_password,@rest_api_enabled,@status,
     @autostart,@crash_guard,@build_id,@extra_args,@created_at)`).run(w);
  return getWorld(w.world_id);
}
function updateWorld(id, patch) {
  const cur = getWorld(id);
  if (!cur) return null;
  const merged = { ...cur, ...patch };
  if (merged.icon_data === undefined) merged.icon_data = null;
  if (merged.banner_data === undefined) merged.banner_data = null;
  if (merged.accent_color === undefined) merged.accent_color = null;
  if (merged.community_server === undefined) merged.community_server = 0;
  if (merged.discord_webhook === undefined || merged.discord_webhook === null) merged.discord_webhook = "";
  if (merged.notify_events === undefined) merged.notify_events = null;
  if (merged.discord_relay_chat === undefined || merged.discord_relay_chat === null) merged.discord_relay_chat = 0;
  if (merged.discord_webhooks === undefined) merged.discord_webhooks = null;
  if (merged.server_password === undefined || merged.server_password === null) merged.server_password = "";
  if (merged.warn_enabled === undefined || merged.warn_enabled === null) merged.warn_enabled = 0;
  if (merged.warn_lead_minutes === undefined || merged.warn_lead_minutes === null) merged.warn_lead_minutes = 10;
  if (merged.warn_interval_minutes === undefined || merged.warn_interval_minutes === null) merged.warn_interval_minutes = 2;
  if (merged.warn_message === undefined || merged.warn_message === null) merged.warn_message = "The server will restart in {minutes} minute(s). Please get to a safe place.";
  if (merged.platform === undefined || merged.platform === null) merged.platform = "linux";
  db().prepare(`UPDATE worlds SET
    display_name=@display_name, install_dir=@install_dir, game_port=@game_port,
    query_port=@query_port, rest_api_port=@rest_api_port, rcon_port=@rcon_port,
    admin_password=@admin_password, rest_api_enabled=@rest_api_enabled,
    rcon_enabled=@rcon_enabled, mods_enabled=@mods_enabled,
    process_id=@process_id, status=@status, autostart=@autostart,
    crash_guard=@crash_guard, build_id=@build_id,
    latest_known_build_id=@latest_known_build_id, crash_count=@crash_count,
    extra_args=@extra_args, last_started_at=@last_started_at,
    icon_data=@icon_data, banner_data=@banner_data, accent_color=@accent_color,
    community_server=@community_server, discord_webhook=@discord_webhook,
    notify_events=@notify_events, discord_relay_chat=@discord_relay_chat,
    discord_webhooks=@discord_webhooks,
    server_password=@server_password, warn_enabled=@warn_enabled,
    warn_lead_minutes=@warn_lead_minutes, warn_interval_minutes=@warn_interval_minutes,
    warn_message=@warn_message
    WHERE world_id=@world_id`).run(merged);
  return getWorld(id);
}
function deleteWorld(id) {
  db().prepare("DELETE FROM worlds WHERE world_id=?").run(id);
  db().prepare("DELETE FROM backups WHERE world_id=?").run(id);
  db().prepare("DELETE FROM schedules WHERE world_id=?").run(id);
  db().prepare("DELETE FROM events WHERE world_id=?").run(id);
  db().prepare("DELETE FROM sessions WHERE world_id=?").run(id);
  db().prepare("DELETE FROM ini_versions WHERE world_id=?").run(id);
  db().prepare("DELETE FROM broadcasts WHERE world_id=?").run(id);
}

// ---- scheduled broadcasts (v1.5.0) ----
function listBroadcasts(worldId) {
  return db().prepare("SELECT * FROM broadcasts WHERE world_id=? ORDER BY fire_at ASC").all(worldId);
}
function insertBroadcast(b) {
  db().prepare("INSERT INTO broadcasts(id,world_id,message,fire_at,created_at) VALUES(@id,@world_id,@message,@fire_at,@created_at)").run(b);
  return db().prepare("SELECT * FROM broadcasts WHERE id=?").get(b.id);
}
function updateBroadcast(id, patch) {
  const cur = db().prepare("SELECT * FROM broadcasts WHERE id=?").get(id);
  if (!cur) return null;
  const merged = { ...cur, ...patch };
  db().prepare("UPDATE broadcasts SET message=@message, fire_at=@fire_at, status=@status WHERE id=@id").run(merged);
  return db().prepare("SELECT * FROM broadcasts WHERE id=?").get(id);
}
function markBroadcastMissed(id) {
  db().prepare("UPDATE broadcasts SET status='missed' WHERE id=?").run(id);
}
function deleteBroadcast(id) {
  db().prepare("DELETE FROM broadcasts WHERE id=?").run(id);
}
// Pending broadcasts across every world whose time has come. Missed ones are left
// alone (they're kept for the user to reschedule or send manually).
function dueBroadcasts(now) {
  return db().prepare("SELECT * FROM broadcasts WHERE fire_at<=? AND status='pending' ORDER BY fire_at ASC").all(now);
}

// ---- ini version history (v1.5.0 in-app ini editor) ----
const INI_HISTORY_MAX = 100; // keep the most recent N snapshots per world
function insertIniVersion(worldId, content, note) {
  db().prepare("INSERT INTO ini_versions(world_id,content,note,created_at) VALUES(?,?,?,?)")
    .run(worldId, content, note || "", Date.now());
  // prune the oldest beyond the cap so history can't grow without bound
  db().prepare(
    `DELETE FROM ini_versions WHERE world_id=? AND id NOT IN
       (SELECT id FROM ini_versions WHERE world_id=? ORDER BY id DESC LIMIT ?)`
  ).run(worldId, worldId, INI_HISTORY_MAX);
}
function listIniVersions(worldId, limit = 100) {
  // metadata only (no content) — keeps the list response small
  return db().prepare("SELECT id, note, created_at, length(content) AS size FROM ini_versions WHERE world_id=? ORDER BY id DESC LIMIT ?").all(worldId, limit);
}
function getIniVersion(worldId, vid) {
  return db().prepare("SELECT * FROM ini_versions WHERE world_id=? AND id=?").get(worldId, vid);
}

// ---- events ----
function logEvent(worldId, kind, message) {
  db().prepare("INSERT INTO events(world_id,kind,message,created_at) VALUES(?,?,?,?)")
    .run(worldId, kind, message || "", Date.now());
}
function listEvents(worldId, limit = 100) {
  if (worldId) {
    return db().prepare("SELECT * FROM events WHERE world_id=? ORDER BY id DESC LIMIT ?").all(worldId, limit);
  }
  return db().prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit);
}

// ---- backups ----
function insertBackup(b) {
  db().prepare("INSERT INTO backups(id,world_id,file_path,size_bytes,reason,created_at) VALUES(@id,@world_id,@file_path,@size_bytes,@reason,@created_at)").run(b);
}
function listBackups(worldId) {
  return db().prepare("SELECT * FROM backups WHERE world_id=? ORDER BY created_at DESC").all(worldId);
}
function deleteBackupRow(id) {
  db().prepare("DELETE FROM backups WHERE id=?").run(id);
}

// ---- schedules ----
function listSchedules(worldId) {
  if (worldId) return db().prepare("SELECT * FROM schedules WHERE world_id=? ORDER BY created_at ASC").all(worldId);
  return db().prepare("SELECT * FROM schedules ORDER BY created_at ASC").all();
}
function insertSchedule(s) {
  db().prepare(`INSERT INTO schedules(id,world_id,job_type,mode,interval_hours,interval_minutes,time_of_day,message,join_match,join_delay_seconds,enabled,created_at)
    VALUES(@id,@world_id,@job_type,@mode,@interval_hours,@interval_minutes,@time_of_day,@message,@join_match,@join_delay_seconds,@enabled,@created_at)`).run(s);
}
function updateScheduleRun(id, ts) {
  db().prepare("UPDATE schedules SET last_run=? WHERE id=?").run(ts, id);
}
function deleteSchedule(id) {
  db().prepare("DELETE FROM schedules WHERE id=?").run(id);
}

// ---- sessions (join/leave) ----
function logSession(worldId, userId, name, event) {
  db().prepare("INSERT INTO sessions(world_id,user_id,player_name,event,created_at) VALUES(?,?,?,?,?)")
    .run(worldId, userId, name, event, Date.now());
}
function listSessions(worldId, limit = 50) {
  // Only presence events belong in the join/leave history. Older builds also wrote
  // chat messages here (event='chat'), which rendered as bogus "leave" entries.
  return db().prepare("SELECT * FROM sessions WHERE world_id=? AND event IN ('join','leave') ORDER BY id DESC LIMIT ?").all(worldId, limit);
}

// ---- mods ----
function listMods(worldId) {
  return db().prepare("SELECT * FROM mods WHERE world_id=? ORDER BY created_at ASC").all(worldId);
}
function getMod(id) {
  return db().prepare("SELECT * FROM mods WHERE id=?").get(id);
}
function insertMod(m) {
  db().prepare(`INSERT INTO mods
    (id, world_id, package_name, display_name, workshop_id, version, source, folder, is_server, enabled, created_at)
    VALUES (@id,@world_id,@package_name,@display_name,@workshop_id,@version,@source,@folder,@is_server,@enabled,@created_at)`).run(m);
  return getMod(m.id);
}
function updateMod(id, patch) {
  const cur = getMod(id);
  if (!cur) return null;
  const merged = { ...cur, ...patch };
  db().prepare(`UPDATE mods SET
    package_name=@package_name, display_name=@display_name, workshop_id=@workshop_id,
    version=@version, source=@source, folder=@folder, is_server=@is_server, enabled=@enabled
    WHERE id=@id`).run(merged);
  return getMod(id);
}
function deleteMod(id) {
  db().prepare("DELETE FROM mods WHERE id=?").run(id);
}

module.exports = {
  db, getSetting, setSetting,
  listWorlds, getWorld, insertWorld, updateWorld, deleteWorld,
  logEvent, listEvents,
  insertBackup, listBackups, deleteBackupRow,
  listSchedules, insertSchedule, updateScheduleRun, deleteSchedule,
  logSession, listSessions,
  insertIniVersion, listIniVersions, getIniVersion,
  listBroadcasts, insertBroadcast, updateBroadcast, markBroadcastMissed, deleteBroadcast, dueBroadcasts,
  listMods, getMod, insertMod, updateMod, deleteMod,
};
