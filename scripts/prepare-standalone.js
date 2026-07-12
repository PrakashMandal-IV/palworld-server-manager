// scripts/prepare-standalone.js
// Assembles a self-contained Next.js standalone server into ./dist-standalone,
// with the exact layout the server expects:
//
//   dist-standalone/
//     server.js
//     .next/            (standalone server chunks)
//     .next/static/     (client assets — copied from top-level .next/static)
//     public/           (static files)
//     node_modules/     (minimal traced deps, produced by Next standalone)
//
// electron-builder then copies this whole folder to resources/app, and
// electron/main.js runs resources/app/server.js.
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const out = path.join(root, "dist-standalone");

function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const item of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, item.name);
    const d = path.join(dst, item.name);
    if (item.isDirectory()) copyDir(s, d);
    else if (item.isSymbolicLink()) {
      try { fs.symlinkSync(fs.readlinkSync(s), d); } catch { fs.copyFileSync(s, d); }
    } else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(standalone)) {
  console.error("ERROR: .next/standalone not found. Run `next build` (output:'standalone') first.");
  process.exit(1);
}

console.log("Assembling standalone app -> dist-standalone/");
rmrf(out);

// 1. copy the whole standalone tree (includes server.js + traced node_modules + .next server chunks)
copyDir(standalone, out);

// 1b. GUARANTEE no local runtime data ships in the app. Next's file tracer can sweep
//     the project-root `.data/` (dev database with worlds + admin passwords, SteamCMD,
//     logs, backups) into the standalone tree. This dir must be recreated fresh on the
//     end user's machine, so scrub it (and other local build artifacts) unconditionally
//     before electron-builder packages dist-standalone into the installer.
for (const junk of [".data", "release", "dist-standalone"]) {
  const p = path.join(out, junk);
  if (fs.existsSync(p)) { rmrf(p); console.log(`Scrubbed local-only dir from build: ${junk}/`); }
}

// 2. copy client static assets into .next/static (standalone does NOT include these)
copyDir(path.join(root, ".next", "static"), path.join(out, ".next", "static"));

// 3. copy public/ (icons etc.)
copyDir(path.join(root, "public"), path.join(out, "public"));

// 4. GUARANTEE the pure-WASM SQLite backend (including its .wasm binary) is present.
//    Next's tracer can miss the runtime-loaded .wasm file, so copy the package whole.
const wasmSrc = path.join(root, "node_modules", "node-sqlite3-wasm");
const wasmDst = path.join(out, "node_modules", "node-sqlite3-wasm");
if (fs.existsSync(wasmSrc)) {
  copyDir(wasmSrc, wasmDst);
  const wasmBin = path.join(wasmDst, "dist", "node-sqlite3-wasm.wasm");
  console.log("node-sqlite3-wasm bundled:", fs.existsSync(wasmBin) ? "OK (.wasm present)" : "WARN (.wasm missing)");
} else {
  console.warn("WARNING: node-sqlite3-wasm not found in node_modules — install it before packaging.");
}

// 5. bundle the first-party UE4SS chat-relay mod so the app can install it into a
//    server at runtime. Copied to dist-standalone/psm-mods (resolved by the server).
const modsSrc = path.join(root, "resources", "mods");
if (fs.existsSync(modsSrc)) {
  copyDir(modsSrc, path.join(out, "psm-mods"));
  console.log("Bundled UE4SS mods: OK (psm-mods/)");
}

// sanity check
const serverJs = path.join(out, "server.js");
if (!fs.existsSync(serverJs)) {
  console.error("ERROR: server.js missing from assembled output.");
  process.exit(1);
}
console.log("Standalone app ready:", out);
