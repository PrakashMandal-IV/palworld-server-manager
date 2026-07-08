# Changelog

All notable changes to Palworld Server Manager are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.1] — Unreleased

### Added
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
