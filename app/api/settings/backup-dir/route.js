import { NextResponse } from "next/server";
const { backupInfo, setBackupDir } = require("@/lib/backups");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req) {
  const worldId = new URL(req.url).searchParams.get("worldId") || undefined;
  return NextResponse.json({ ok: true, backup: backupInfo(worldId) });
}

export async function POST(req) {
  try {
    const { path: p } = await req.json();
    return NextResponse.json({ ok: true, backup: setBackupDir(p) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
