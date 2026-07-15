// lib/presence.js
// Background player-presence tracker. Polls each running, REST-enabled world's
// player list on an interval, diffs it against the previous snapshot, records
// join/leave sessions, and fires "join"/"leave" Discord notifications (routed
// per-world like every other event via notify()).
//
// This is the single source of truth for session diffing — the API routes no
// longer diff inline, so there's exactly one place that logs sessions and one
// place that can notify, avoiding double-counting from overlapping polls.
const dbm = require("./db");
const sup = require("./supervisor");
const rest = require("./restclient");
const { notify } = require("./notify");
const { fireJoinSchedules } = require("./scheduler");

const PRESENCE_MS = 10000; // 10s — snappy enough for join/leave, light on the REST API
const g = globalThis;
if (!g.__PAL_PRESENCE) g.__PAL_PRESENCE = new Map(); // world_id -> Map(uid -> name)

const keyOf = (p) => String(p.userId || p.playerId || p.name || "").trim();

// Diff one world's current player list against its last snapshot. Logs sessions
// for both join and leave; only NOTIFIES once a baseline exists, so the first
// observation of a world (app just booted, or world just started with players
// already on) seeds silently instead of spamming a join for everyone online.
function observe(world, players) {
  const wid = world.world_id;
  const now = new Map();
  for (const p of players || []) {
    const uid = keyOf(p);
    if (uid) now.set(uid, p.name || uid);
  }
  const hadBaseline = g.__PAL_PRESENCE.has(wid);
  const prev = g.__PAL_PRESENCE.get(wid) || new Map();

  const joined = [];
  const left = [];
  for (const [uid, name] of now) if (!prev.has(uid)) { dbm.logSession(wid, uid, name, "join"); joined.push(name); }
  for (const [uid, name] of prev) if (!now.has(uid)) { dbm.logSession(wid, uid, name, "leave"); left.push(name); }
  g.__PAL_PRESENCE.set(wid, now);

  if (hadBaseline) {
    for (const name of joined) {
      notify(wid, "join", `${name} joined ${world.display_name}`).catch(() => {});
      // Fire any "when a player joins" scheduled messages/notices for this join.
      fireJoinSchedules(wid, name).catch(() => {});
    }
    for (const name of left) notify(wid, "leave", `${name} left ${world.display_name}`).catch(() => {});
  }
}

async function tick() {
  if (g.__PAL_PRESENCE_BUSY) return;
  g.__PAL_PRESENCE_BUSY = true;
  try {
    for (const w of dbm.listWorlds()) {
      const running = sup.isRunning(w.world_id) || sup.pidAlive(w.process_id);
      if (!running || !w.rest_api_enabled) {
        // Drop the baseline for stopped worlds so a later restart re-seeds
        // silently — the "stop" event already covers everyone leaving.
        g.__PAL_PRESENCE.delete(w.world_id);
        continue;
      }
      let res;
      try { res = await rest.players(w); }
      catch { continue; } // transient (server busy/booting): keep baseline, no false leaves
      observe(w, res && res.players ? res.players : []);
    }
  } finally {
    g.__PAL_PRESENCE_BUSY = false;
  }
}

function ensurePresence() {
  if (g.__PAL_PRESENCE_TIMER) return;
  g.__PAL_PRESENCE_TIMER = setInterval(() => { tick().catch(() => {}); }, PRESENCE_MS);
  tick().catch(() => {}); // seed baselines immediately so the first real change notifies
}

// Is this player in the latest snapshot? Delayed on-join messages use this to
// avoid greeting someone who already left during their delay. The snapshot is at
// most PRESENCE_MS old, so a player who left seconds ago may still read as online
// — close enough for a greeting, and it always settles within one poll.
function isOnline(worldId, name) {
  const snap = g.__PAL_PRESENCE.get(worldId);
  const want = String(name || "").trim().toLowerCase();
  if (!snap || !want) return false;
  for (const n of snap.values()) if (String(n).trim().toLowerCase() === want) return true;
  return false;
}

module.exports = { ensurePresence, observe, isOnline };
