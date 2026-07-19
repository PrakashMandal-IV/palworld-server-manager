import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const sup = require("@/lib/supervisor");
const palschema = require("@/lib/palschema");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET: PalSchema install status + content-mod list for this world.
export async function GET(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...palschema.status(w.install_dir) });
}

// POST: install the PalSchema framework. With no zipPath, download the latest release
// from GitHub; with a zipPath, install from that file. Refused while the world runs.
export async function POST(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (sup.isRunning(w.world_id) || sup.pidAlive(w.process_id)) {
    return NextResponse.json({ ok: false, error: "Stop the world before installing PalSchema." }, { status: 409 });
  }
  const { zipPath = null } = await req.json().catch(() => ({}));
  try {
    const res = await palschema.installFramework(w.install_dir, { zipPath });
    dbm.logEvent(params.id, "mods", `Installed PalSchema framework${res.version ? ` (${res.version})` : ""}`);
    return NextResponse.json({ ok: true, ...res, ...palschema.status(w.install_dir) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
