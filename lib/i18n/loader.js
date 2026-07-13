// lib/i18n/loader.js
// Server-side (nodejs runtime) loader for translation packs.
//
// WHY THIS IS SERVER-SIDE: the React UI runs in a browser renderer with context
// isolation on (electron/preload.js exposes no fs). So every disk read for locale
// packs happens here, and the strings reach the client either SSR'd into first
// paint (app/layout.js) or fetched over HTTP (/api/i18n/*).
//
// Two sources, English always merged underneath as the fallback language:
//   - inbuilt (read-only):  <appRoot>/public/locales/*.json   (shipped in the build,
//                           copied into the standalone tree by prepare-standalone.js)
//   - user    (writable):   %APPDATA%/.../languagepacks/*.json (imported / downloaded)
const fs = require("fs");
const path = require("path");
const { P } = require("../paths");

const BASE = "en";
// process.cwd() is the app root in both dev and the packaged standalone build
// (the shipped version route relies on the same fact to read package.json).
const inbuiltDir = () => path.join(process.cwd(), "public", "locales");

// Parse one pack file → { code, meta, strings } or null if malformed.
function readPackFile(file) {
  try {
    const pack = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!pack || typeof pack !== "object") return null;
    const meta = pack.meta && typeof pack.meta === "object" ? pack.meta : {};
    const strings = pack.strings;
    if (!strings || typeof strings !== "object" || Array.isArray(strings)) return null;
    const code = meta.code || path.basename(file, ".json");
    return { code, meta, strings };
  } catch {
    return null;
  }
}

// Scan a directory for *.json packs → Map<code, {code, meta, strings, custom}>.
function scanDir(dir, custom) {
  const out = new Map();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".json"));
  } catch {
    return out; // dir may not exist yet (no user packs) — fine.
  }
  for (const f of files) {
    const pack = readPackFile(path.join(dir, f));
    if (pack && pack.code) out.set(pack.code, { ...pack, custom });
  }
  return out;
}

// All packs, user packs overriding inbuilt of the same code.
function allPacks() {
  const merged = scanDir(inbuiltDir(), false);
  for (const [code, pack] of scanDir(P.languagePacks(), true)) merged.set(code, pack);
  return merged;
}

function baseStrings(packs) {
  const en = (packs || allPacks()).get(BASE);
  return en ? en.strings : {};
}

// Public: languages available to pick, with completeness % vs. the English base.
function listLanguages() {
  const packs = allPacks();
  const baseKeys = Object.keys(baseStrings(packs));
  const total = baseKeys.length || 1;
  const list = [];
  for (const [code, pack] of packs) {
    const translated = baseKeys.filter(
      (k) => typeof pack.strings[k] === "string" && pack.strings[k] !== ""
    ).length;
    list.push({
      code,
      name: pack.meta.name || code,
      nativeName: pack.meta.nativeName || pack.meta.name || code,
      dir: pack.meta.dir === "rtl" ? "rtl" : "ltr",
      custom: !!pack.custom,
      completeness: code === BASE ? 100 : Math.round((translated / total) * 100),
    });
  }
  list.sort((a, b) =>
    a.code === BASE ? -1 : b.code === BASE ? 1 : a.name.localeCompare(b.name)
  );
  return list;
}

// Public: i18next resources for a language. English is always present so i18next's
// per-key fallbackLng handles any strings a partial pack is missing.
function loadResources(lng) {
  const packs = allPacks();
  const resources = { [BASE]: { translation: baseStrings(packs) } };
  if (lng && lng !== BASE && packs.has(lng)) {
    resources[lng] = { translation: packs.get(lng).strings };
  }
  return resources;
}

// Public: text direction + resolved code for one language (drives <html dir>).
function languageMeta(lng) {
  const packs = allPacks();
  const p = packs.get(lng) || packs.get(BASE);
  return { code: p ? p.code : BASE, dir: p && p.meta.dir === "rtl" ? "rtl" : "ltr" };
}

module.exports = { BASE, allPacks, listLanguages, loadResources, languageMeta };
