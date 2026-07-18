import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const sup = require("@/lib/supervisor");
const palschema = require("@/lib/palschema");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST: manage PalSchema content mods for this world.
//   { action: "import", zipPath }
//   { action: "toggle", name, enabled }
//   { action: "remove", name }
// Mods load at server boot, so changes are refused while the world is running.
export async function POST(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (sup.isRunning(w.world_id) || sup.pidAlive(w.process_id)) {
    return NextResponse.json({ ok: false, error: "Stop the world before changing PalSchema mods." }, { status: 409 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "import") {
      if (!body.zipPath) return NextResponse.json({ ok: false, error: "Provide the mod zip path." }, { status: 400 });
      const result = palschema.importMod(w.install_dir, body.zipPath);
      dbm.logEvent(params.id, "mods", `Imported PalSchema mod ${result.name}`);
      return NextResponse.json({ ok: true, result, mods: palschema.listMods(w.install_dir) });
    }
    if (body.action === "toggle") {
      const mods = palschema.setModEnabled(w.install_dir, body.name, !!body.enabled);
      dbm.logEvent(params.id, "mods", `${body.enabled ? "Enabled" : "Disabled"} PalSchema mod ${body.name} (restart to apply)`);
      return NextResponse.json({ ok: true, mods });
    }
    if (body.action === "remove") {
      const mods = palschema.removeMod(w.install_dir, body.name);
      dbm.logEvent(params.id, "mods", `Removed PalSchema mod ${body.name}`);
      return NextResponse.json({ ok: true, mods });
    }
    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
