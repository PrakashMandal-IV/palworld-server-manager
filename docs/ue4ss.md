# UE4SS / Lua mod support

Palworld dedicated servers have two unrelated modding systems. The app manages both,
in clearly separated sections of the Mods tab:

1. **Steam Workshop mods** — Pocketpair's official system. Files live in
   `<install>/Mods/` and are toggled via `Mods/PalModSettings.ini`. Managed by
   `lib/mods.js`.
2. **UE4SS / Lua mods** — a third-party framework (UE4SS) that injects and runs Lua
   script mods at runtime. This is what most Palworld mods on Nexus use. Managed by
   `lib/ue4ss.js`.

## How UE4SS is laid out (dedicated server)

```
<install>/Pal/Binaries/Win64/
  dwmapi.dll                 UE4SS injector (its presence = "installed")
  ue4ss/
    UE4SS-settings.ini       runtime config
    Mods/                    <- UE4SS 3.0 mods location
      mods.txt               load order + enable flags:  "ModName : 1"
      <ModName>/
        enabled.txt          optional: force-load regardless of mods.txt
        Scripts/main.lua     the Lua mod entry point
```

**Version note:** UE4SS 3.0 moved everything except `dwmapi.dll` under a `ue4ss/`
subfolder, so Lua mods live in `Win64/ue4ss/Mods`. Older versions used `Win64/Mods`
directly. The app resolves the correct folder automatically (`lib/ue4ss.js` →
`modsDir`), preferring the `ue4ss/Mods` layout when the `ue4ss/` folder is present.

**Critical:** `UE4SS-settings.ini` must have `GuiConsoleVisible=0` on a dedicated
server. A visible console makes UE4SS try to open a window and the server crashes on
launch. The app forces this to `0` on install and offers a one-click fix if it detects
the console enabled.

## What the app does

- **Install** (`POST /api/worlds/[id]/ue4ss`, body `{ zipPath }`): the user supplies the
  official UE4SS release zip (we don't redistribute or auto-download it — the correct
  build tracks the game version). The app finds the payload root by locating `dwmapi.dll`
  inside the archive, extracts it into `Win64`, then forces `GuiConsoleVisible=0`.
- **Detect** (`GET`): reports installed / injector / runtime / console-safe.
- **Fix console** (`PATCH`): forces `GuiConsoleVisible=0`.
- **Mods** (`POST /api/worlds/[id]/ue4ss/mods`, `{ action }`):
  - `import` — extract a Lua mod zip (must contain `Scripts/main.lua`) into `Mods/`,
    registered disabled in `mods.txt`.
  - `toggle` — set `ModName : 0|1` in `mods.txt`; disabling also removes a stray
    `enabled.txt` (which would otherwise force-load the mod).
  - `remove` — delete the mod folder and its `mods.txt` entry.

Mods load only at server boot, so the world must be **restarted** after any change.
UE4SS install is refused while the world is running.

## Limits

- UE4SS is Windows-only and is a third-party tool the app does not bundle.
- The correct UE4SS build depends on the current Palworld version; the user is
  responsible for downloading a compatible release.
