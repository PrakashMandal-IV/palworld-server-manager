import { NextResponse } from "next/server";
const dbm = require("@/lib/db");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET: the full content of one historical version (for preview / diff).
export async function GET(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const v = dbm.getIniVersion(w.world_id, Number(params.vid));
  if (!v) return NextResponse.json({ ok: false, error: "version not found" }, { status: 404 });
  return NextResponse.json({ ok: true, version: v });
}
