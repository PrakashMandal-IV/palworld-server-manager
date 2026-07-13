// lib/i18n/validate.js
// Validator + sanitizer for UNTRUSTED translation packs (imported from a file or
// downloaded from the internet). Inbuilt packs under public/locales are trusted and
// never pass through here.
//
// The threat model: a pack is arbitrary JSON a user obtained from who-knows-where.
// It reaches the app, gets written to disk (P.languagePacks()), then loaded straight
// into i18next as interpolation-free strings. So we must guarantee the result is a
// flat map of string→string with a safe language code, no prototype-pollution keys,
// and bounded size — and we whitelist every field we keep rather than trusting the
// input shape.

const MAX_BYTES = 512 * 1024;   // 512 KB — packs are plain text, this is generous
const MAX_KEYS = 3000;          // en ships ~600 keys; 3000 leaves head-room, blocks abuse
const CODE_RE = /^[a-z]{2}(-[A-Z]{2})?$/; // e.g. "de", "pt-BR"
const DANGER_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const BASE = "en";

function fail(error) { return { ok: false, error }; }

// Validate a raw pack STRING (the exact bytes read from a file / downloaded).
// Returns { ok, pack } with a freshly-built, whitelisted pack object, or { ok:false, error }.
function validatePackText(text) {
  if (typeof text !== "string") return fail("Pack is not text.");
  // Byte length, not string length — multibyte translations shouldn't slip the cap.
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) return fail("Pack is too large (max 512 KB).");

  let raw;
  try { raw = JSON.parse(text); } catch { return fail("Pack is not valid JSON."); }
  return validatePackObject(raw);
}

function validatePackObject(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("Pack must be a JSON object.");

  const meta = raw.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return fail("Pack is missing its meta block.");

  const code = typeof meta.code === "string" ? meta.code.trim() : "";
  if (!CODE_RE.test(code)) return fail("Pack has an invalid language code (expected e.g. \"de\" or \"pt-BR\").");
  if (code === BASE) return fail("The English (en) base pack can't be replaced.");

  const strings = raw.strings;
  if (!strings || typeof strings !== "object" || Array.isArray(strings)) return fail("Pack has no valid \"strings\" map.");

  // Own enumerable keys only — never walk the prototype chain.
  const keys = Object.keys(strings);
  if (keys.length === 0) return fail("Pack contains no translations.");
  if (keys.length > MAX_KEYS) return fail(`Pack has too many keys (max ${MAX_KEYS}).`);

  const clean = Object.create(null); // no prototype → assignment can't pollute Object.prototype
  for (const k of keys) {
    if (DANGER_KEYS.has(k)) return fail("Pack contains a disallowed key.");
    const v = strings[k];
    // Every value must be a plain string. Nested objects/arrays/functions are rejected
    // outright — that's both the pack contract and the anti-pollution guarantee.
    if (typeof v !== "string") return fail(`Value for "${k}" is not a string.`);
    clean[k] = v;
  }

  // Whitelist meta fields; coerce to safe types with sane defaults.
  const asString = (x, d) => (typeof x === "string" && x.trim() ? x.trim() : d);
  const authors = Array.isArray(meta.authors)
    ? meta.authors.filter((a) => typeof a === "string").slice(0, 20)
    : [];

  const pack = {
    meta: {
      code,
      name: asString(meta.name, code),
      nativeName: asString(meta.nativeName, asString(meta.name, code)),
      dir: meta.dir === "rtl" ? "rtl" : "ltr",
      schema: 1,
      authors,
    },
    // Spread over a null-proto object into a normal object for JSON.stringify.
    strings: { ...clean },
  };
  return { ok: true, pack };
}

module.exports = { validatePackText, validatePackObject, MAX_BYTES, MAX_KEYS };
