import { NextResponse } from "next/server";
const dbm = require("@/lib/db");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KEYS = ["theme", "discordWebhook", "notifyEvents", "backupRetention", "discordRelayChat", "chatCaptureEnabled"];

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
  if (k === "notifyEvents") return {};
  if (k === "discordRelayChat") return false;
  if (k === "chatCaptureEnabled") return true;
  return "";
}
