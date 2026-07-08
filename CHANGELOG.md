# Changelog

All notable changes to Palworld Server Manager are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-07-09

### Added
- **App version + update check in the sidebar.** The footer now shows the app
  name and version (replacing the old "Admin / local" placeholder). The app checks
  its GitHub releases and, when a newer version is published, shows an "Update
  available" button that opens the latest release page to download the new build.
- **Full UE4SS support** for Lua mods (the kind most Palworld mods on Nexus use),
  managed separately from Steam Workshop mods in the Mods tab:
  - Install UE4SS into a world from a user-provided release zip; the app extracts it
    into `Pal\Binaries\Win64` and forces `GuiConsoleVisible=0` (a visible console
    crashes a dedicated server on launch).
  - Detect whether UE4SS is installed and whether its console setting is server-safe,
    with a one-click fix.
  - Import, enable/disable (via `mods.txt` + `enabled.txt`), and remove Lua mods.

## [1.1.0] — 2026-07-08

### Added
- **Change a world's install folder** from the Admin tab. Point a world at the
  correct `PalServer` folder on any drive without removing and re-adding it — the
  new path is validated as a real Palworld install, and mods, saves, and settings
  are then read from the right place. The world must be stopped to change it.
- **"Send test" button** for Discord notifications in Settings. Sends a test
  message to the entered webhook URL (before saving) and reports whether Discord
  accepted it, so you can verify the webhook without having to start or stop a
  world.

### Fixed
- **Build version now shows correctly** in the world list and on the world page
  instead of always displaying "—". Adopted Steam installs and worlds that
  missed capture at install time now have their build detected automatically,
  with a fallback to the running server's game version.

## [1.0.0]

Initial public release.

- Provision new Palworld dedicated servers via SteamCMD, or adopt an existing
  install.
- Start / stop / restart / update each world, with a crash guardian for
  automatic restarts.
- Full `PalWorldSettings.ini` editor (100+ settings) with search, per-field
  reset, presets, and minimal-diff writes.
- Players panel (kick / ban / unban via the official REST API), live console,
  backups (take / restore / schedule), scheduler, and mod import/toggle.
- Per-world customization (icon, banner, accent color) and settings/profile
  export & import.
- Multiple worlds side by side with auto-assigned ports.
- Discord webhook notifications for server events.
- Windows installer and Linux AppImage, built and published via GitHub Actions.
