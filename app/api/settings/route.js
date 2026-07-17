import { NextResponse } from "next/server";
const dbm = require("@/lib/db");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Discord webhook/notify-events/chat-relay moved to per-world (world Admin tab).
const KEYS = ["theme", "backupRetention", "chatCaptureEnabled", "hideConsoleWindow", "language", "onboarded", "autoUpdateEnabled", "updateCheckIntervalMinutes"];

// Read a setting, normalising the "never chosen" cases. getSetting only falls back when
// the row is missing, so a row holding null would otherwise reach the UI as null.
function read(k) {
  const v = dbm.getSetting(k, defaultFor(k));
  // Hiding the console window is on unless explicitly turned off, so a fresh install,
  // a reinstall, an upgrade, or a null row all report on.
  if (k === "hideConsoleWindow") return v !== false;
  return v;
}

function readAll() {
  const out = {};
  for (const k of KEYS) out[k] = read(k);
  return out;
}

export async function GET() {
  return NextResponse.json({ ok: true, settings: readAll() });
}

export async function POST(req) {
  const patch = await req.json();
  // Ignore null/undefined: "no opinion" must not overwrite a real choice with a null row.
  for (const k of KEYS) if (k in patch && patch[k] != null) dbm.setSetting(k, patch[k]);
  return NextResponse.json({ ok: true, settings: readAll() });
}

function defaultFor(k) {
  if (k === "theme") return "dark";
  if (k === "backupRetention") return 10;
  if (k === "chatCaptureEnabled") return true;
  if (k === "hideConsoleWindow") return true;
  if (k === "language") return "en";
  if (k === "onboarded") return false;
  if (k === "autoUpdateEnabled") return false;
  if (k === "updateCheckIntervalMinutes") return 30;
  return "";
}
