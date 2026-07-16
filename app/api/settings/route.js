import { NextResponse } from "next/server";
const dbm = require("@/lib/db");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Discord webhook/notify-events/chat-relay moved to per-world (world Admin tab).
const KEYS = ["theme", "backupRetention", "chatCaptureEnabled", "hideConsoleWindow", "language", "onboarded"];

export async function GET() {
  const out = {};
  for (const k of KEYS) out[k] = dbm.getSetting(k, defaultFor(k));
  return NextResponse.json({ ok: true, settings: out });
}

export async function POST(req) {
  const patch = await req.json();
  for (const k of KEYS) if (k in patch) dbm.setSetting(k, patch[k]);
  const out = {};
  for (const k of KEYS) out[k] = dbm.getSetting(k, defaultFor(k));
  return NextResponse.json({ ok: true, settings: out });
}

function defaultFor(k) {
  if (k === "theme") return "dark";
  if (k === "backupRetention") return 10;
  if (k === "chatCaptureEnabled") return true;
  if (k === "hideConsoleWindow") return true;
  if (k === "language") return "en";
  if (k === "onboarded") return false;
  return "";
}
