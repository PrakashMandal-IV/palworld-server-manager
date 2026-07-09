import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const sup = require("@/lib/supervisor");
const ue4ss = require("@/lib/ue4ss");
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET: current chat buffer + whether the capture mod / UE4SS are installed for this
// world, and whether the capture feature is enabled globally.
export async function GET(_req, { params }) {
  const w = dbm.getWorld(params.id);
  const modInstalled = w ? sup.chatModInstalled(w.install_dir) : false;
  let ue4ssInstalled = false;
  try { ue4ssInstalled = w ? ue4ss.detect(w.install_dir).installed : false; } catch {}
  return NextResponse.json({
    ok: true,
    chat: sup.getChat(params.id),
    modInstalled,
    ue4ssInstalled,
    bundledAvailable: !!sup.bundledChatModDir(),
    captureEnabled: dbm.getSetting("chatCaptureEnabled", true),
  });
}

// POST: install the bundled PSMChatRelay UE4SS mod into this world's server.
export async function POST(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const res = sup.installChatMod(w.install_dir);
    dbm.logEvent(params.id, "mods", "Installed chat relay mod (PSMChatRelay)");
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}

// DELETE: remove the chat relay mod from this world's server. The escape hatch if a
// Palworld update ever makes the mod misbehave — the game then runs mod-free.
export async function DELETE(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const res = sup.uninstallChatMod(w.install_dir);
    dbm.logEvent(params.id, "mods", "Removed chat relay mod (PSMChatRelay)");
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
