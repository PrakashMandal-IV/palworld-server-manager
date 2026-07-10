import { NextResponse } from "next/server";
const dbm = require("@/lib/db");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET: version history (metadata only) for this world's ini.
export async function GET(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, versions: dbm.listIniVersions(w.world_id) });
}
