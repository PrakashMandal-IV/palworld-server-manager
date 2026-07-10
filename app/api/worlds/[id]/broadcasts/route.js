import { NextResponse } from "next/server";
const crypto = require("crypto");
const dbm = require("@/lib/db");
const rest = require("@/lib/restclient");
const sup = require("@/lib/supervisor");
const { ensureScheduler } = require("@/lib/scheduler");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// List this world's pending scheduled broadcasts.
export async function GET(_req, { params }) {
  return NextResponse.json({ ok: true, broadcasts: dbm.listBroadcasts(params.id) });
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
      await rest.announce(w, message);
      dbm.logEvent(params.id, "broadcast", `Sent broadcast: ${message}`);
      return NextResponse.json({ ok: true, sent: true });
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
