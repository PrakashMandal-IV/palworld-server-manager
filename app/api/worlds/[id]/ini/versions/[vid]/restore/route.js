import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const ini = require("@/lib/ini");
const sup = require("@/lib/supervisor");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST: restore a historical version — snapshot the current file first, then
// write the chosen version's content back to PalWorldSettings.ini.
export async function POST(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const v = dbm.getIniVersion(w.world_id, Number(params.vid));
  if (!v) return NextResponse.json({ ok: false, error: "version not found" }, { status: 404 });

  const cur = ini.readRawSettings(w.install_dir);
  if (cur.exists && cur.content) dbm.insertIniVersion(w.world_id, cur.content, "before restore");
  const path = ini.writeRawSettings(w.install_dir, v.content);
  dbm.insertIniVersion(w.world_id, v.content, `restored from #${v.id}`);
  dbm.logEvent(w.world_id, "settings", `Restored PalWorldSettings.ini from history #${v.id} (restart to apply)`);
  return NextResponse.json({ ok: true, path, content: v.content, running: sup.isRunning(w.world_id) });
}
