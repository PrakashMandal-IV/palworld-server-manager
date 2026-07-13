import { NextResponse } from "next/server";
const fs = require("fs");
const path = require("path");
const { P } = require("@/lib/paths");
const { validatePackText } = require("@/lib/i18n/validate");
const { getText } = require("@/lib/i18n/fetch");
const { listLanguages } = require("@/lib/i18n/loader");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST { url, updatedAt? } — download a pack the user pastes a link to (or that the
// community-pack catalog points at), then validate + save it exactly like an imported
// file. The transport (getText) is https-only, size-capped mid-stream, and time-boxed.
//
// After validation we stamp provenance onto the CLEAN pack (never trusting the pack's
// own meta): meta.source = the url it came from, meta.updatedAt = the catalog's date.
// The registry route compares that stamp against the index to flag stale packs.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return bad("Invalid request body."); }

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  let parsed;
  try { parsed = new URL(url); } catch { return bad("Enter a valid URL."); }
  if (parsed.protocol !== "https:") return bad("Only https:// links are allowed.");

  let text;
  try { text = await getText(url); }
  catch (e) { return bad(e.message || "Download failed.", 502); }

  const { ok, pack, error } = validatePackText(text);
  if (!ok) return bad(error);

  // Provenance (post-validation so the validator stays pure).
  pack.meta.source = url;
  const updatedAt = typeof body?.updatedAt === "string" ? body.updatedAt.trim() : "";
  if (updatedAt) pack.meta.updatedAt = updatedAt.slice(0, 32);

  try {
    const file = path.join(P.languagePacks(), `${pack.meta.code}.json`);
    fs.writeFileSync(file, JSON.stringify(pack, null, 2), "utf8");
  } catch {
    return bad("Could not save the language pack.", 500);
  }

  const language = listLanguages().find((l) => l.code === pack.meta.code) || null;
  return NextResponse.json({ ok: true, language });
}

function bad(error, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
