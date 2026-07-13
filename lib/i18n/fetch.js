// lib/i18n/fetch.js
// One hardened https text fetcher shared by every i18n route that touches the
// network (pack download + registry index). https-only, 8s timeout, byte-capped
// mid-stream, follows at most 4 redirects and refuses any redirect that leaves
// https — lifted verbatim from the download route so there is a single code
// path to audit.
const https = require("https");
const { MAX_BYTES } = require("./validate");

const MAX_REDIRECTS = 4;

function getText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "palworld-server-manager", Accept: "application/json, text/plain" },
      timeout: 8000,
    }, (res) => {
      // Follow https redirects (GitHub raw / release assets bounce through a CDN).
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        if (redirects >= MAX_REDIRECTS) return reject(new Error("Too many redirects."));
        const next = new URL(res.headers.location, url);
        if (next.protocol !== "https:") return reject(new Error("Redirect left https."));
        return getText(next.toString(), redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.destroy(); return reject(new Error(`Server responded ${res.statusCode}.`)); }

      let bytes = 0;
      const chunks = [];
      res.on("data", (c) => {
        bytes += c.length;
        if (bytes > MAX_BYTES) { res.destroy(); reject(new Error("Pack is too large (max 512 KB).")); return; }
        chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("error", () => reject(new Error("Could not reach that host.")));
    req.on("timeout", () => { req.destroy(); reject(new Error("Download timed out.")); });
  });
}

module.exports = { getText };
