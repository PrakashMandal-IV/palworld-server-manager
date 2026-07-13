import { NextResponse } from "next/server";
const fs = require("fs");
const path = require("path");
const { P } = require("@/lib/paths");
const { validatePackText } = require("@/lib/i18n/validate");
const { listLanguages } = require("@/lib/i18n/loader");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST { content } — content is the raw text of a *.json pack the user picked with a
// file input (the renderer has no fs, so it reads the file and sends the text). The
// pack is validated + sanitized, then written to the writable languagepacks dir.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return bad("Invalid request body."); }

  const { ok, pack, error } = validatePackText(body?.content);
  if (!ok) return bad(error);

  try {
    const file = path.join(P.languagePacks(), `${pack.meta.code}.json`);
    fs.writeFileSync(file, JSON.stringify(pack, null, 2), "utf8");
  } catch {
    return bad("Could not save the language pack.", 500);
  }

  const language = listLanguages().find((l) => l.code === pack.meta.code) || null;
  return NextResponse.json({ ok: true, language });
}

// DELETE ?code=xx — remove an imported (custom) pack. Inbuilt packs live under
// public/locales and are never touched here, so this can only delete user packs.
export async function DELETE(req) {
  const code = new URL(req.url).searchParams.get("code") || "";
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(code)) return bad("Invalid language code.");

  const file = path.join(P.languagePacks(), `${code}.json`);
  // Contain the path to the languagepacks dir — reject any code that resolves outside.
  if (path.dirname(file) !== P.languagePacks()) return bad("Invalid language code.");
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    return bad("Could not remove the language pack.", 500);
  }
  return NextResponse.json({ ok: true, languages: listLanguages() });
}

function bad(error, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
