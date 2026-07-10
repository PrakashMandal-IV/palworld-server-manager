import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const sup = require("@/lib/supervisor");
const ue4ss = require("@/lib/ue4ss");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET: whether the on-screen broadcast mod / UE4SS are installed for this world.
export async function GET(_req, { params }) {
  const w = dbm.getWorld(params.id);
  const modInstalled = w ? sup.broadcastModInstalled(w.install_dir) : false;
  let ue4ssInstalled = false;
  try { ue4ssInstalled = w ? ue4ss.detect(w.install_dir).installed : false; } catch {}
  return NextResponse.json({
    ok: true,
    modInstalled,
    ue4ssInstalled,
    bundledAvailable: !!sup.bundledBroadcastModDir(),
  });
}

// POST: install the bundled PSMBroadcast UE4SS mod into this world's server.
export async function POST(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const res = sup.installBroadcastMod(w.install_dir);
    dbm.logEvent(params.id, "mods", "Installed on-screen broadcast mod (PSMBroadcast)");
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}

// DELETE: remove the broadcast mod from this world's server. Broadcasts then fall back
// to the REST announce (chat feed).
export async function DELETE(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const res = sup.uninstallBroadcastMod(w.install_dir);
    dbm.logEvent(params.id, "mods", "Removed on-screen broadcast mod (PSMBroadcast)");
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
