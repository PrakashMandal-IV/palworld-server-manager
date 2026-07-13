import { NextResponse } from "next/server";
const { listLanguages } = require("@/lib/i18n/loader");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Languages the user can pick (inbuilt + imported), each with a completeness %.
export async function GET() {
  return NextResponse.json({ ok: true, languages: listLanguages() });
}
