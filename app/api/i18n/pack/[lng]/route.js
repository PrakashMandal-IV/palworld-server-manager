import { NextResponse } from "next/server";
const { loadResources, BASE } = require("@/lib/i18n/loader");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Serves the i18next resource bundle for one language (English always included as
// the fallback). The client fetches this when switching to a language it hasn't
// loaded yet, then addResourceBundle + changeLanguage on the shared instance.
export async function GET(_req, { params }) {
  const lng = params.lng;
  const resources = loadResources(lng);
  if (lng !== BASE && !resources[lng]) {
    return NextResponse.json({ ok: false, error: "Unknown language" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, lng, resources });
}
