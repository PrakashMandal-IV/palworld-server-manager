import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const rest = require("@/lib/restclient");
const sup = require("@/lib/supervisor");
const steam = require("@/lib/steamcmd");
const { boot } = require("@/lib/bootstrap");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Back-fill a missing build id from the on-disk Steam manifest so worlds that
// were adopted (or missed capture at install time) still show their build.
function ensureBuildId(w) {
  if (w.build_id) return w;
  try {
    const bid = steam.readInstalledBuildId(w.install_dir);
    if (bid) {
      dbm.updateWorld(w.world_id, { build_id: bid });
      return { ...w, build_id: bid };
    }
  } catch {}
  return w;
}

export async function GET() {
  boot();
  const worlds = dbm.listWorlds().map(ensureBuildId);
  const enriched = await Promise.all(
    worlds.map(async (w) => {
      const running = sup.isRunning(w.world_id) || sup.pidAlive(w.process_id);
      let live = null, apiUp = false;
      if (running && w.rest_api_enabled) {
        try {
          const [metrics, players] = await Promise.all([
            rest.metrics(w).catch(() => null),
            rest.players(w).catch(() => null),
          ]);
          apiUp = !!(metrics || players);
          live = {
            uptime: metrics?.uptime ?? null,
            fps: metrics?.serverfps ?? metrics?.fps ?? null,
            days: metrics?.days ?? null,
            currentPlayers: players?.players?.length ?? metrics?.currentplayernum ?? 0,
            maxPlayers: metrics?.maxplayernum ?? null,
          };
        } catch {}
      }
      const updateState = steam.updateStateOf(w);
      return { ...w, running, apiUp, live, updateState, updateAvailable: updateState === "available" };
    })
  );
  return NextResponse.json({ ok: true, worlds: enriched });
}
