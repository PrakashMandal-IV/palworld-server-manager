// lib/mapcal.js
// Map calibration math for the SERVER side — the Discord /player-location renderer
// (lib/mapimage.js). It mirrors the same transform the in-app Live Map runs
// client-side (components/MapPanel.jsx); the two are kept as separate copies on
// purpose so this one never drags React/DOM code into the Node server, the same way
// fmtUptime is duplicated in discordbot.js. PURE: no fs/db imports, so loading the
// calibration points is the caller's job (the server reads db + the baked file).
//
// Projecting means mapping a player's world (x,y) -> a 0..1 position on the map
// image. The transform is an affine fit of calibration points; until there are
// 3+ points it falls back to DEFAULT_CAL, an axis-aligned guess.

const DEFAULT_CAL = { nxM: 7.492e-7, nxB: 0.4461, nyM: -7.512e-7, nyB: 0.2945 };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// In-game "compass" coordinate players recognise, for labels/tooltips.
function mapCoord(x, y) {
  return { mx: Math.round((x + 122500) / 458.355), my: Math.round((y - 158100) / 458.355) };
}

// Least-squares fit of  v = a*x + b*y + c  over the points (v is nx or ny).
function fitPlane(pts, val) {
  let Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0, S1 = 0, bx = 0, by = 0, b1 = 0;
  for (const p of pts) {
    const x = p.x, y = p.y, v = val(p);
    Sxx += x * x; Sxy += x * y; Sx += x; Syy += y * y; Sy += y; S1 += 1;
    bx += v * x; by += v * y; b1 += v;
  }
  return solve3([[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, S1]], [bx, by, b1]);
}
const det3 = (m) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
function solve3(M, r) {
  const d = det3(M);
  if (Math.abs(d) < 1e-9) return null;
  const col = (i, v) => M.map((row, k) => row.map((c, j) => (j === i ? v[k] : c)));
  return [det3(col(0, r)) / d, det3(col(1, r)) / d, det3(col(2, r)) / d];
}

// Build a project(x,y)->{nx,ny} from >=3 calibration points, or null. Coords are
// scaled down (they're ~1e5–1e6) so the normal equations stay well-conditioned.
function buildTransform(points) {
  if (!points || points.length < 3) return null;
  const S = 1e-6;
  const P = points.map((p) => ({ x: p.x * S, y: p.y * S, nx: p.nx, ny: p.ny }));
  const cx = fitPlane(P, (p) => p.nx);
  const cy = fitPlane(P, (p) => p.ny);
  if (!cx || !cy) return null;
  return (x, y) => ({
    nx: clamp01(cx[0] * x * S + cx[1] * y * S + cx[2]),
    ny: clamp01(cy[0] * x * S + cy[1] * y * S + cy[2]),
  });
}

// A projector for the given calibration points: the affine fit when there are
// enough points, otherwise the axis-aligned DEFAULT_CAL fallback.
function makeProjector(points) {
  const t = buildTransform(points);
  if (t) return t;
  return (x, y) => ({
    nx: clamp01(DEFAULT_CAL.nxM * y + DEFAULT_CAL.nxB),
    ny: clamp01(DEFAULT_CAL.nyM * x + DEFAULT_CAL.nyB),
  });
}

// A small deterministic accent colour per player so dots stay stable across polls.
// Returned as {r,g,b} 0..255 (server drawing) — the client re-derives the same hue.
function dotColor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return hslToRgb(h / 360, 0.7, 0.55);
}
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

// The id Palworld's endpoints use, matching the app's Players tab / the bot.
const pkey = (p) => String(p.userId || p.playerId || p.name || "");

module.exports = { DEFAULT_CAL, clamp01, mapCoord, buildTransform, makeProjector, dotColor, hslToRgb, pkey };
