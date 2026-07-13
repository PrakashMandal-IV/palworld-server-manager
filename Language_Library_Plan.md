# Language Library — Implementation Plan

Turn the current *"paste a URL"* download flow into a **browsable, curated catalog** of
community language packs with one‑click install and update detection.

This builds directly on what already exists — it adds a **source** (a catalog) on top
of the **transport** (`/api/i18n/download`) that's already shipped.

---

## 1. What exists today (the foundation we reuse)

| Piece | File | Reused for the library |
|---|---|---|
| Pack format `{meta, strings}` | `public/locales/*.json` | Catalog entries point at files in this exact format |
| Server loader + completeness % | `lib/i18n/loader.js` (`listLanguages`, `allPacks`, `loadResources`) | Detect which catalog packs are already installed |
| Untrusted‑pack validator | `lib/i18n/validate.js` (`validatePackText`) | Every catalog install still passes through this — catalog packs are **not** trusted |
| Download transport | `app/api/i18n/download/route.js` (https‑only, size‑cap, redirect/timeout `getText`) | Install = call this with the catalog entry's `url` |
| Import / remove | `app/api/i18n/import/route.js` (POST text, DELETE `?code`) | Remove stays as‑is |
| GitHub fetch + TTL cache pattern | `app/api/app/version/route.js` (`https.get`, `globalThis.__PAL_*`) | Same pattern for fetching the catalog index |
| Settings language card | `app/settings/page.jsx` | Add a "Browse community packs" section/modal |
| Writable pack dir | `lib/paths.js` (`P.languagePacks()`) | Unchanged |

**Design principle:** the catalog is a *discovery* layer. A pack installed from the
catalog goes through the identical validate → write path as a hand‑pasted URL, so the
security model does not change.

---

## 2. Architecture

```
   GitHub repo (source of truth)              App (Palworld Server Manager)
   ┌─────────────────────────────┐            ┌──────────────────────────────────┐
   │ registry/index.json         │  https     │ GET /api/i18n/registry           │
   │   → lists available packs    │◄───────────│   fetch+cache index, mark which   │
   │ registry/packs/de.json       │            │   codes are already installed     │
   │ registry/packs/fr.json       │            ├──────────────────────────────────┤
   │ registry/packs/…             │            │ Settings → "Browse community      │
   └─────────────────────────────┘            │   packs" list → [Install]         │
              ▲                                │     → POST /api/i18n/download {url}│
              │ PR + CI validation             │        (existing route, validates) │
   community translators                       └──────────────────────────────────┘
```

- **Index** = one small JSON file the app fetches to know *what's available*.
- **Packs** = individual `<code>.json` files (same format as `public/locales/*`).
- **Install** = download the pack file by its `url` → validate → write to
  `P.languagePacks()`. Reuses the shipped route entirely.

---

## 3. Data contracts

### 3.1 Catalog index — `registry/index.json` (hosted in the repo)

```json
{
  "schema": 1,
  "updatedAt": "2026-07-12",
  "packs": [
    {
      "code": "de",
      "name": "German",
      "nativeName": "Deutsch",
      "dir": "ltr",
      "authors": ["community-handle"],
      "url": "https://raw.githubusercontent.com/PrakashMandal-IV/palworld-server-manager/main/registry/packs/de.json",
      "updatedAt": "2026-07-01",
      "completeness": 87,
      "appMinVersion": "2.0.0"
    }
  ]
}
```

- `url` — direct https link to the pack file. **Must** be host‑allowlisted (see §6).
- `completeness` — a **hint** computed by CI (§7). Authoritative % is recomputed by
  `loader.js` after install; the hint is only for the pre‑install browse list.
- `updatedAt` — drives update detection (§5).
- `appMinVersion` — optional; lets a pack require a newer app. UI greys out / warns if
  the running app (`/api/app/version` → `current`) is older.

### 3.2 Installed‑pack provenance (new, optional meta fields)

When installing from the catalog, stamp two fields so we can later detect updates:

```jsonc
"meta": { …, "source": "<catalog url>", "updatedAt": "2026-07-01" }
```

`validate.js` currently **whitelists** meta fields and drops unknowns, so either:
- **(recommended)** extend the whitelist to preserve `source` (string, https) and
  `updatedAt` (string), **or**
- have the download route stamp them *after* validation returns the clean pack.

Keep the validator pure → prefer stamping in the route.

---

## 4. New / changed code

### 4.1 `lib/i18n/fetch.js`  *(new — extract, don't duplicate)*
Move `getText(url)` out of `download/route.js` into a shared module so both the
download route and the registry route use one hardened fetcher.

```js
// exports { getText }  — https-only, 8s timeout, ≤MAX_BYTES streamed, ≤4 redirects,
// rejects redirects that leave https. (Lifted verbatim from download/route.js.)
```
Then `download/route.js` imports it; behaviour identical, one code path to audit.

### 4.2 `app/api/i18n/registry/route.js`  *(new)*
```js
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REGISTRY_URL = process.env.PAL_I18N_REGISTRY_URL ||
  "https://raw.githubusercontent.com/PrakashMandal-IV/palworld-server-manager/main/registry/index.json";
const TTL = 30 * 60 * 1000;               // cache the index for 30 min

export async function GET() {
  // 1. fetch+cache index via getText (globalThis.__PAL_I18N_REG, version-route pattern)
  // 2. validateIndex(text): schema===1, packs is array (cap ≤500), each entry has a
  //    valid code (reuse CODE_RE), https url on an allow-listed host, string fields.
  // 3. cross-reference lib/i18n/loader.listLanguages():
  //    installed = code present; updateAvailable = installed pack.meta.updatedAt < entry.updatedAt
  // 4. return { ok, checked, packs:[{...entry, installed, updateAvailable}], error? }
  // On fetch failure: { ok:true, checked:false, packs:[] } so the UI degrades to
  //    "couldn't reach the catalog — you can still paste a URL / import a file".
}
```
- **Reuses:** `getText` (§4.1), `listLanguages()`, `CODE_RE`, the `globalThis` TTL cache
  idiom from `version/route.js`.
- **No new install route** — install reuses `POST /api/i18n/download`.

### 4.3 `app/api/i18n/download/route.js`  *(minor change)*
- Import `getText` from `lib/i18n/fetch.js` (remove the inline copy).
- Accept optional `{ url, updatedAt }`; after `validatePackText` succeeds, stamp
  `pack.meta.source = url` and `pack.meta.updatedAt = updatedAt` before writing. Enables
  update detection without trusting the pack's own meta.

### 4.4 `app/settings/page.jsx`  *(UI)*
Add a **"Browse community packs"** block (or a modal opened from the language card):
- On open: `GET /api/i18n/registry`.
- Render each pack row: `nativeName` · `name` · `completeness%` · authors, and a button:
  - **Install** (not installed) → `POST /api/i18n/download {url, updatedAt}` → toast →
    `refreshLangs()` + re‑fetch registry.
  - **Installed** (present, up to date) → disabled/checkmark.
  - **Update** (present, `updateAvailable`) → same install call (overwrites the file).
- `appMinVersion` newer than running app → disabled row with a "needs app vX" note.
- `checked:false` (offline) → inline notice pointing at the existing file‑import / URL box.
- Reuse existing `packBusy` state, `toast`, and `switchLanguage` wiring already in the card.

New i18n keys (add to `en.json` + `es.json`, keep 100% parity):
`language.browseTitle`, `language.browseDesc`, `language.browse`, `language.install`,
`language.installing`, `language.installed`, `language.update`, `language.catalogOffline`,
`language.needsAppVersion`, `language.byAuthors`, `language.noPacks`.

---

## 5. Update detection (Phase B)

1. Install stamps `meta.source` + `meta.updatedAt` (§4.3).
2. Registry route compares installed `meta.updatedAt` vs the index entry's `updatedAt`
   (string date compare, or bump to an integer `revision` for robustness).
3. UI shows **Update** on stale packs; clicking re‑downloads and overwrites.

If we skip provenance in v1, the row just shows **Installed** with no update signal —
acceptable for a first cut; Phase B adds the diff.

---

## 6. Security

The catalog widens *discovery*, not *trust*. Guardrails:

- **Index URL is a fixed constant** (env‑overridable), never user input → no SSRF via the
  index fetch itself.
- **Pack `url` host allow‑list.** Reject index entries whose `url` host isn't in a small
  set: the index host + `raw.githubusercontent.com` + `objects.githubusercontent.com`
  (release assets) + `github.com`. Prevents a tampered/compromised index from pointing the
  app at arbitrary internal hosts.
- **Every install still runs `validatePackText`** — 512 KB byte cap, ≤3000 keys, code
  regex, rejects `__proto__`/`constructor`/`prototype`, string‑only values, refuses to
  overwrite `en`. Unchanged.
- **Index validation:** cap `packs.length` (≤500), require `schema===1`, coerce/whitelist
  every field, drop malformed entries rather than failing the whole list.
- **https only + size cap + timeout** on both index and pack fetches (shared `getText`).
- No code execution, no eval — packs are pure string maps loaded by i18next.

---

## 7. Contribution & CI (Phase C)

Make it easy to *add* packs and impossible to merge a *broken* one.

**Repo layout**
```
registry/
  index.json           # the catalog
  packs/
    de.json  fr.json  … # pack files, our format
scripts/
  new-pack.js          # scaffolds a skeleton pack from en.json (all keys, empty values)
  validate-registry.js # CI: validates every pack + index; recomputes completeness
```

**Translator workflow (CONTRIBUTING.md section)**
1. `node scripts/new-pack.js fr "French" "Français"` → writes `registry/packs/fr.json`
   with every key from `en.json` and empty values to fill in.
2. Fill in translations (partial is fine — missing keys fall back to English per‑key).
3. Add an entry to `registry/index.json`.
4. Open a PR.

**CI (GitHub Action) on PR**
- Run `scripts/validate-registry.js`:
  - each `registry/packs/*.json` passes `validatePackText`;
  - each `index.json` entry resolves to an existing pack file, https/allow‑listed url,
    valid `code`, no duplicates;
  - recompute `completeness` against current `en.json` and **write it back** to the index
    (so the hint never drifts);
  - fail the build on any invalid pack.
- This guarantees everything merged into the catalog is installable.

---

## 8. Packaging

Nothing to bundle — the catalog is remote. Only requirement: the `REGISTRY_URL` constant
points at the real repo/branch that actually hosts `registry/index.json`. Inbuilt packs
still ship in `public/locales/` (already copied by `prepare-standalone.js`).

**Open decision:** branch strategy for the catalog. Options:
- `main` under `registry/` (simplest; catalog changes ride normal PRs) — **recommended**.
- a dedicated `packs` branch (decouples catalog cadence from app releases).
- GitHub Pages / a Release asset (stable URL, but more moving parts).

---

## 9. Testing

- **Unit:** `validateIndex` (good/oversized/malformed/duplicate/bad‑host entries);
  `getText` (redirect, size‑cap abort, timeout).
- **Route e2e** (node fetch vs dev server, as done for import/download):
  registry GET with a mock index → correct `installed`/`updateAvailable` flags;
  install via `/api/i18n/download` → appears in `listLanguages` + `/api/i18n/pack/<code>`;
  offline index → `checked:false`.
- **Browser:** open Browse, install a pack, verify it enters the picker and switches;
  re‑open Browse → row shows **Installed**; bump index `updatedAt` → row shows **Update**.

---

## 10. Phasing & effort

| Phase | Scope | Rough effort |
|---|---|---|
| **A — MVP** | `lib/i18n/fetch.js` extract · `/api/i18n/registry` · `registry/index.json` + 1–2 seed packs in repo · Browse UI (install only) · i18n keys | ~half a day |
| **B — Updates** | provenance stamping · `updateAvailable` diff · Update button | ~2–3 hrs |
| **C — Community** | `new-pack.js` · `validate-registry.js` · CI action · CONTRIBUTING docs | ~half a day |

Phase A is independently shippable and immediately useful; B and C harden and scale it.

---

## 11. Summary of files

**New**
- `lib/i18n/fetch.js` — shared hardened `getText`
- `app/api/i18n/registry/route.js` — catalog index fetch + install/update state
- `registry/index.json`, `registry/packs/*.json` — the hosted catalog
- `scripts/new-pack.js`, `scripts/validate-registry.js` — authoring + CI (Phase C)
- `.github/workflows/validate-registry.yml` — CI (Phase C)

**Changed**
- `app/api/i18n/download/route.js` — use shared `getText`, stamp provenance
- `lib/i18n/validate.js` — (optional) preserve `source`/`updatedAt` meta
- `app/settings/page.jsx` — Browse community packs UI
- `public/locales/en.json`, `es.json` — new `language.*` keys
- `CONTRIBUTING.md` — translator guide (Phase C)

**Unchanged / reused as‑is**
- `lib/i18n/loader.js`, `app/api/i18n/import/route.js`, `app/api/i18n/languages/route.js`,
  `app/api/i18n/pack/[lng]/route.js`, `lib/paths.js`
