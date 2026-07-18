import { NextResponse } from "next/server";
const prov = require("@/lib/provision");
const { conflictsInRegistry } = require("@/lib/ports");
const guard = require("@/lib/installdir");
const dbm = require("@/lib/db");
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(req) {
  const body = await req.json();
  const { install_dir, ports } = body || {};
  if (!install_dir) return NextResponse.json({ ok: false, error: "install_dir is required" }, { status: 400 });
  const bad = guard.unusableTargetReason(install_dir, { worlds: dbm.listWorlds() });
  if (bad) return NextResponse.json({ ok: false, error: bad }, { status: 409 });
  if (ports) {
    const c = conflictsInRegistry(ports);
    if (c.length) return NextResponse.json({ ok: false, error: `Port conflict with ${c[0].usedBy} (port ${c[0].port})` }, { status: 400 });
  }
  try {
    const r = prov.adoptExistingInstall(body);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
