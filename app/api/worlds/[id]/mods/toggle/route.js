import { NextResponse } from "next/server";
const mods = require("@/lib/mods");
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req, { params }) {
  const { packageName, enabled, global, force } = await req.json();
  try {
    if (typeof global === "boolean") return NextResponse.json({ ok: true, ...mods.setGlobalEnable(params.id, global) });
    // `force` lets a mod that never declared IsServer run anyway — the client sends it
    // only after the user confirms the warning.
    return NextResponse.json({ ok: true, ...mods.setModEnabled(params.id, packageName, !!enabled, !!force) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}
