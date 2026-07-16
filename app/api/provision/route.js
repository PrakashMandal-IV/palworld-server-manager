import { NextResponse } from "next/server";
const prov = require("@/lib/provision");
const { conflictsInRegistry } = require("@/lib/ports");
const guard = require("@/lib/installdir");
const dbm = require("@/lib/db");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req) {
  const body = await req.json();
  const { display_name, install_dir, ports, admin_password } = body || {};
  if (!install_dir) return NextResponse.json({ ok: false, error: "install_dir is required" }, { status: 400 });

  // SteamCMD installs straight into this folder, so a folder that already holds
  // another world would fuse the two — and later delete both together (#9).
  const bad = guard.unusableTargetReason(install_dir, { worlds: dbm.listWorlds() });
  if (bad) return NextResponse.json({ ok: false, error: bad }, { status: 409 });

  if (ports) {
    const conflicts = conflictsInRegistry(ports);
    if (conflicts.length)
      return NextResponse.json({ ok: false, error: `Port conflict with ${conflicts[0].usedBy} (port ${conflicts[0].port})` }, { status: 400 });
  }

  const world = prov.createProfile({ display_name, install_dir, ports, admin_password });
  const jobId = prov.newJob(world.world_id, world.display_name);
  // fire and forget — UI tracks progress via the downloads tray (/api/jobs)
  prov.provisionWorld(jobId, world.world_id);
  return NextResponse.json({ ok: true, world, jobId });
}
