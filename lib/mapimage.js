// lib/mapimage.js  (server-only)
// Renders the Palworld world map with numbered dots at each player's position, for
// the Discord /player-location command. Numbered dots + a name legend (built by the
// caller) read far better than names crammed onto the image, and need only digit
// glyphs — so this stays pure-JS (jpeg-js decode, pngjs encode), with no native
// binaries to break the standalone bundle.
//
// Compute stays off the game servers entirely (they're separate processes) and low
// on the manager: the base map is decoded and downscaled ONCE and cached in memory,
// so each command is just a buffer copy, a few circles, and a fast PNG encode.
const fs = require("fs");
const path = require("path");
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");
const dbm = require("./db");
const { makeProjector, mapCoord, dotColor, pkey } = require("./mapcal");
const font = require("./mapfont");

const MAP_JPG = () => path.join(process.cwd(), "public", "map", "palworld-map.jpg");
const CAL_FILE = () => path.join(process.cwd(), "public", "map", "calibration.json");
const TARGET_W = 1000; // downscale width — keeps the PNG small and the encode quick

// ---- base map cache -------------------------------------------------------------
// { mtimeMs, W, H, rgba } — rebuilt only when the source jpg changes on disk.
let BASE = null;

function loadBaseMap() {
  const file = MAP_JPG();
  let st;
  try { st = fs.statSync(file); } catch { throw new Error("world map image is missing"); }
  if (BASE && BASE.mtimeMs === st.mtimeMs) return BASE;

  const raw = jpeg.decode(fs.readFileSync(file), { useTArray: true, maxMemoryUsageInMB: 512 });
  const scale = Math.min(1, TARGET_W / raw.width);
  const W = Math.max(1, Math.round(raw.width * scale));
  const H = Math.max(1, Math.round(raw.height * scale));
  const rgba = Buffer.alloc(W * H * 4);
  // Nearest-neighbour downscale — fine for a background image, and cheap.
  for (let y = 0; y < H; y++) {
    const sy = Math.min(raw.height - 1, Math.floor(y / scale));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(raw.width - 1, Math.floor(x / scale));
      const si = (sy * raw.width + sx) * 4;
      const di = (y * W + x) * 4;
      rgba[di] = raw.data[si]; rgba[di + 1] = raw.data[si + 1];
      rgba[di + 2] = raw.data[si + 2]; rgba[di + 3] = 255;
    }
  }
  BASE = { mtimeMs: st.mtimeMs, W, H, rgba };
  return BASE;
}

function loadCalibrationPoints() {
  try {
    const pts = dbm.getSetting("mapCalibration", []);
    if (Array.isArray(pts) && pts.length >= 3) return pts;
  } catch { /* fall through to baked */ }
  try {
    const j = JSON.parse(fs.readFileSync(CAL_FILE(), "utf8"));
    if (Array.isArray(j.points)) return j.points;
  } catch { /* none */ }
  return [];
}

// ---- drawing primitives (on an RGBA Buffer) -------------------------------------
function blend(buf, W, H, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const ia = a / 255, ib = 1 - ia;
  buf[i] = Math.round(r * ia + buf[i] * ib);
  buf[i + 1] = Math.round(g * ia + buf[i + 1] * ib);
  buf[i + 2] = Math.round(b * ia + buf[i + 2] * ib);
  buf[i + 3] = 255;
}

function fillCircle(buf, W, H, cx, cy, radius, color, a = 255) {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      // 1px soft edge so dots don't look jagged.
      const edge = radius - Math.sqrt(d2);
      const aa = edge >= 1 ? a : Math.max(0, Math.round(a * edge));
      blend(buf, W, H, cx + dx, cy + dy, color.r, color.g, color.b, aa);
    }
  }
}

function strokeCircle(buf, W, H, cx, cy, radius, color, a = 255) {
  for (let t = 0; t < 360; t += 3) {
    const rad = (t * Math.PI) / 180;
    blend(buf, W, H, Math.round(cx + radius * Math.cos(rad)), Math.round(cy + radius * Math.sin(rad)), color.r, color.g, color.b, a);
  }
}

// Draw `text` with its top-left at (ox, oy) using the shared 5x7 bitmap font.
function drawText(buf, W, H, ox, oy, text, scale, color, a = 255) {
  const gw = font.GLYPH_W, gh = font.GLYPH_H, gap = 1;
  let x = Math.round(ox);
  const y = Math.round(oy);
  for (const ch of String(text)) {
    const glyph = font.rowsFor(ch);
    for (let row = 0; row < gh; row++) {
      for (let col = 0; col < gw; col++) {
        if (!(glyph[row] & (1 << (gw - 1 - col)))) continue;
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++)
            blend(buf, W, H, x + col * scale + sx, y + row * scale + sy, color.r, color.g, color.b, a);
      }
    }
    x += (gw + gap) * scale;
  }
}

function fillRect(buf, W, H, x0, y0, w, h, color, a) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++)
      blend(buf, W, H, x, y, color.r, color.g, color.b, a);
}

// A name pill (dark rounded-ish background + white text), like the app's Live Map
// tooltip, centred horizontally on the dot and sitting just above it. Flips below
// the dot when it would run off the top edge.
function drawNameLabel(buf, W, H, cx, dotTop, dotBottom, text, scale) {
  const white = { r: 255, g: 255, b: 255 };
  const bg = { r: 15, g: 17, b: 23 };
  const padX = 3 * scale, padY = 2 * scale;
  const tw = font.textWidth(text, scale), th = font.GLYPH_H * scale;
  const boxW = tw + padX * 2, boxH = th + padY * 2;
  let x0 = Math.round(cx - boxW / 2);
  let y0 = dotTop - 3 * scale - boxH;        // above the dot
  if (y0 < 2) y0 = dotBottom + 3 * scale;    // no room up top → drop below
  x0 = Math.max(1, Math.min(x0, W - boxW - 1)); // keep on-image
  fillRect(buf, W, H, x0, y0, boxW, boxH, bg, 205);
  drawText(buf, W, H, x0 + padX, y0 + padY, text, scale, white, 255);
}

// ---- public: render the map -----------------------------------------------------
// players: raw REST player objects (need location_x/location_y). selectKeys: optional
// array of pkey()s to include (null/empty = everyone). Returns { buffer, entries,
// total, plotted } where entries are the numbered, plotted players in legend order.
function renderPlayerMap(players, selectKeys = null) {
  const base = loadBaseMap();
  const { W, H } = base;
  const project = makeProjector(loadCalibrationPoints());

  const wanted = selectKeys && selectKeys.length ? new Set(selectKeys.map(String)) : null;
  const usable = (players || [])
    .filter((p) => typeof p.location_x === "number" && typeof p.location_y === "number")
    .filter((p) => !wanted || wanted.has(pkey(p)))
    .sort((a, b) => String(a.name || pkey(a)).localeCompare(String(b.name || pkey(b))));

  const buf = Buffer.from(base.rgba); // copy so the cache stays pristine
  const white = { r: 255, g: 255, b: 255 };
  const dark = { r: 20, g: 20, b: 24 };
  const entries = [];

  const scale = 2, radius = 7;
  usable.forEach((p, idx) => {
    const n = idx + 1;
    const key = pkey(p);
    const name = p.name || key;
    const { nx, ny } = project(p.location_x, p.location_y);
    const cx = Math.round(nx * W), cy = Math.round(ny * H);
    const col = dotColor(key);
    fillCircle(buf, W, H, cx, cy, radius + 2, dark, 235); // outline/shadow ring
    fillCircle(buf, W, H, cx, cy, radius, col, 255);
    strokeCircle(buf, W, H, cx, cy, radius, white, 230);
    // Name label above the dot, like the in-app map.
    drawNameLabel(buf, W, H, cx, cy - radius - 2, cy + radius + 2, name, scale);
    const { mx, my } = mapCoord(p.location_x, p.location_y);
    entries.push({ n, key, name, level: p.level ?? null, mx, my });
  });

  const png = new PNG({ width: W, height: H });
  buf.copy(png.data);
  const buffer = PNG.sync.write(png, { colorType: 6 });
  return { buffer, entries, total: (players || []).length, plotted: usable.length };
}

module.exports = { renderPlayerMap };
