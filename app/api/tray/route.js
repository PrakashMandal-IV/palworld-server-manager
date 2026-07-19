import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const sup = require("@/lib/supervisor");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lightweight world list for the desktop system-tray menu. Deliberately DB-only — no
// REST probing or live metrics — so the tray can refresh it every few seconds without
// hammering each server. Just enough to label a menu entry and show a running dot.
export async function GET() {
  const worlds = dbm.listWorlds().map((w) => ({
    world_id: w.world_id,
    display_name: w.display_name || w.world_id,
    running: sup.isRunning(w.world_id) || sup.pidAlive(w.process_id),
  }));
  return NextResponse.json({ ok: true, worlds });
}
