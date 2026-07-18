// lib/bootstrap.js
// Called by API routes to make sure background engines are running.
const dbm = require("./db");
const sup = require("./supervisor");
const { ensureScheduler } = require("./scheduler");
const { ensureSampler } = require("./metrics");
const { ensurePresence } = require("./presence");
const { ensureBots } = require("./discordbot");

const g = globalThis;

function boot() {
  if (g.__PAL_BOOTED) return;
  try {
    sup.ensureGuardian();
    ensureScheduler();
    ensureSampler();
    ensurePresence();
    // Reconnect any world's Discord bot. Wrapped because a bot that won't connect —
    // revoked token, no internet — must never stop the app from booting.
    try { ensureBots(); } catch (e) { console.error("discord bot boot", e && e.message); }
    // autostart worlds flagged for it
    for (const w of dbm.listWorlds()) {
      if (w.autostart) {
        sup.startWorld(w.world_id).catch(() => {});
      } else if (w.status === "running") {
        // stale status from a previous run where the process is gone
        if (!sup.pidAlive(w.process_id)) dbm.updateWorld(w.world_id, { status: "stopped", process_id: null });
      }
    }
    // Only mark booted after we successfully read the registry. If the DB was
    // transiently locked, we leave __PAL_BOOTED unset so the next request retries.
    g.__PAL_BOOTED = true;
  } catch (e) {
    console.error("bootstrap error", e && e.message ? e.message : e);
    // do NOT set __PAL_BOOTED — allow a later request to retry cleanly.
  }
}

module.exports = { boot };
