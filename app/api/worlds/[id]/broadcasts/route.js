import { NextResponse } from "next/server";
const crypto = require("crypto");
const dbm = require("@/lib/db");
const rest = require("@/lib/restclient");
const sup = require("@/lib/supervisor");
const ue4ss = require("@/lib/ue4ss");
const { ensureScheduler } = require("@/lib/scheduler");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Deliver a message now: on-screen via the PSMBroadcast mod when installed, else the
// REST announce (chat feed). Returns which path was used.
async function deliverBroadcast(w, message) {
  if (sup.broadcastModInstalled(w.install_dir)) {
    sup.enqueueBroadcast(w.install_dir, message);
    return "mod";
  }
  await rest.announce(w, message);
  return "rest";
}

// List this world's pending scheduled broadcasts + on-screen-mod status for the UI.
export async function GET(_req, { params }) {
  const w = dbm.getWorld(params.id);
  const modInstalled = w ? sup.broadcastModInstalled(w.install_dir) : false;
  let ue4ssInstalled = false;
  try { ue4ssInstalled = w ? ue4ss.detect(w.install_dir).installed : false; } catch {}
  return NextResponse.json({
    ok: true,
    broadcasts: dbm.listBroadcasts(params.id),
    modInstalled,
    ue4ssInstalled,
    bundledAvailable: !!sup.bundledBroadcastModDir(),
  });
}

// POST { message, immediate } -> send now
// POST { message, fire_at }   -> schedule for later
export async function POST(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const body = await req.json();
  const message = String(body.message || "").trim();
  if (!message) return NextResponse.json({ ok: false, error: "Message is required" }, { status: 400 });

  if (body.immediate) {
    if (!sup.isRunning(params.id)) return NextResponse.json({ ok: false, error: "Start the world to broadcast." }, { status: 409 });
    try {
      // Prefer the on-screen broadcast mod when it's installed; otherwise fall back to
      // the REST announce (shows in the chat feed).
      const via = await deliverBroadcast(w, message);
      dbm.logEvent(params.id, "broadcast", `Sent broadcast (${via}): ${message}`);
      return NextResponse.json({ ok: true, sent: true, via });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
  }

  const fireAt = Number(body.fire_at);
  if (!fireAt || fireAt <= Date.now()) return NextResponse.json({ ok: false, error: "Pick a time in the future." }, { status: 400 });
  const b = dbm.insertBroadcast({ id: crypto.randomUUID(), world_id: params.id, message, fire_at: fireAt, created_at: Date.now() });
  ensureScheduler();
  return NextResponse.json({ ok: true, broadcast: b });
}
