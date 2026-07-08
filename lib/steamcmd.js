// lib/steamcmd.js  (spec §2 provisioning, §8 update checking)
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { spawn } = require("child_process");
const { P } = require("./paths");

const PALWORLD_APPID = "2394010";

function steamcmdBinary() {
  const dir = P.steamcmd();
  return os.platform() === "win32"
    ? path.join(dir, "steamcmd.exe")
    : path.join(dir, "steamcmd.sh");
}

function steamcmdInstalled() {
  return fs.existsSync(steamcmdBinary());
}

// Download + unpack the shared SteamCMD once (spec §2 step 2).
async function ensureSteamCmd(onLog = () => {}) {
  if (steamcmdInstalled()) return steamcmdBinary();
  const dir = P.steamcmd();
  const plat = os.platform();
  const url =
    plat === "win32"
      ? "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
      : "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz";
  onLog(`Downloading SteamCMD from ${url}`);
  const archive = path.join(dir, plat === "win32" ? "steamcmd.zip" : "steamcmd.tar.gz");
  await download(url, archive);
  onLog("Extracting SteamCMD...");
  if (plat === "win32") {
    const AdmZip = require("adm-zip");
    new AdmZip(archive).extractAllTo(dir, true);
  } else {
    await run("tar", ["-xzf", archive, "-C", dir]);
    try { fs.chmodSync(steamcmdBinary(), 0o755); } catch {}
  }
  onLog("SteamCMD ready.");
  return steamcmdBinary();
}

// Install or update a world into its install_dir (spec §2 step 3, §8 step 5).
// Streams stdout lines to onLog. Resolves with exit code.
function installOrUpdate(installDir, onLog = () => {}) {
  return new Promise((resolve, reject) => {
    const bin = steamcmdBinary();
    const args = [
      "+force_install_dir", installDir,
      "+login", "anonymous",
      "+app_update", PALWORLD_APPID, "validate",
      "+quit",
    ];
    onLog(`> steamcmd ${args.join(" ")}`);
    const child = spawn(bin, args, { cwd: P.steamcmd() });
    child.stdout.on("data", (d) => splitLines(d).forEach(onLog));
    child.stderr.on("data", (d) => splitLines(d).forEach(onLog));
    child.on("error", reject);
    child.on("close", (code) => {
      onLog(`SteamCMD exited with code ${code}`);
      resolve(code);
    });
  });
}

// Read the installed build id from the app manifest (spec §2 step 5).
// The manifest lives in different places depending on how the server was
// installed, so we check the known layouts:
//   • app-provisioned (+force_install_dir): <installDir>/steamapps/appmanifest_*.acf
//   • Steam client / SteamCMD default:      <installDir>/../../appmanifest_*.acf
//     (install dir is .../steamapps/common/PalServer)
function readInstalledBuildId(installDir) {
  if (!installDir) return null;
  const name = `appmanifest_${PALWORLD_APPID}.acf`;
  const candidates = [
    path.join(installDir, "steamapps", name),
    path.join(installDir, "..", "..", name),
    path.join(installDir, "..", name),
  ];
  for (const acf of candidates) {
    try {
      if (!fs.existsSync(acf)) continue;
      const text = fs.readFileSync(acf, "utf8");
      const m = text.match(/"buildid"\s+"(\d+)"/);
      if (m) return m[1];
    } catch {}
  }
  return null;
}

// Query the latest public build id via Steam's public web API (spec §8 step 1).
async function fetchLatestBuildId() {
  const url = `https://api.steamcmd.net/v1/info/${PALWORLD_APPID}`;
  try {
    const json = await getJson(url);
    const bid = json?.data?.[PALWORLD_APPID]?.depots?.branches?.public?.buildid;
    return bid ? String(bid) : null;
  } catch {
    return null;
  }
}

// ---- helpers ----
function splitLines(buf) {
  return buf.toString("utf8").split(/\r?\n/).filter((l) => l.length);
}
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args);
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (e) => { try { fs.unlinkSync(dest); } catch {} reject(e); });
  });
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

module.exports = {
  PALWORLD_APPID, steamcmdBinary, steamcmdInstalled, ensureSteamCmd,
  installOrUpdate, readInstalledBuildId, fetchLatestBuildId,
};
