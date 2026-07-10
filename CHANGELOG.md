# Changelog

All notable changes to Palworld Server Manager are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.4.1] — 2026-07-10

### Fixed
- **Chat messages no longer show up as "left" in Join/Leave history.** Typing an
  in-game message used to write a bogus entry into the presence log, which the
  history rendered as the player leaving. Chat is no longer recorded as a
  presence event, and existing stray rows are filtered out — no reinstall needed.
- **System join/leave broadcasts stay out of the chat feed.** Palworld's own
  "player joined" notices travel through the chat hook with no sender and are
  localized to the server's game language (often Japanese), so they showed up as
  garbled chat and relayed to Discord. These sender-less broadcasts are now
  dropped both in the app and in the PSMChatRelay mod, leaving only real player
  chat. Join/leave is still tracked in the dedicated Join/Leave history.

## [1.4.0] — 2026-07-09

### Changed
- **Discord webhooks are now per world.** The single global webhook in Settings
  moved into a dedicated **Discord** tab on each world, so every server can post
  start/stop/restart/update alerts and chat relay to its own channel. Each world
  carries its own webhook, event toggles, and chat-relay switch, with a clear
  **unsaved-changes** bar so edits are never lost by forgetting to save. The old
  global Discord setting (and any webhook stored in it) is cleared automatically;
  Settings now points you to the per-world location.
- **Safer world deletion.** Deleting a world now opens a dialog that separates
  *delete profile only* (default — server files kept) from *delete profile +
  server files on disk*. The destructive option requires typing the world's name
  to confirm, GitHub-style, so a full on-disk wipe can't happen by accident.
- **Mod & chat changes require a stopped world.** Adding, enabling/disabling, or
  removing Steam Workshop mods, UE4SS Lua mods, and the chat relay mod are now
  disabled while a world is running, with a prompt to stop it first — these only
  take effect at boot anyway.
- **Rebranded the sidebar** to the app icon and **PSM** wordmark.

### Fixed
- **Modals no longer close when selecting text with the mouse.** Dragging a
  selection inside a dialog (New world, Customize, Delete) and releasing the
  button outside it used to dismiss the dialog. Backdrop clicks now only close a
  modal when the press both starts and ends on the backdrop.

### Added
- **Usage section — live CPU & memory monitoring.** A new **Usage** entry in the
  sidebar graphs real-time CPU and memory for every running world. View all
  running worlds together (aggregate CPU/memory line charts over time plus
  per-world comparison bars) or pick a single world from the scope selector to
  drill into its own CPU and memory graphs with current and peak stats. Usage is
  sampled across each server's full process tree, so it reflects the real
  shipping binary the launcher spawns — not just the launcher process. The
  sampler stays idle while no world is running.
- **In-game chat capture & Discord relay.** The **Chat** tab now shows live
  in-game player chat while a world runs. Palworld never exposes chat to the
  server console or REST API, so the app ships its own small UE4SS Lua mod
  (PSMChatRelay) that you install into a world with one click; it captures chat
  to a file the app tails in real time. Chat can optionally be relayed to a
  Discord webhook for a Palworld→Discord feed. The mod installs into the folder
  the running UE4SS build actually scans (`ue4ss\Mods` on UE4SS 3.x, `Mods` on
  2.x) and reads only the chat fields that are safe to touch, so it won't crash
  the dedicated server.
- **Guided chat setup with a full off-switch.** If UE4SS isn't installed on a
  world, the Chat tab links straight to the UE4SS installer; once UE4SS is
  present it offers the one-click relay-mod install. A global **In-game chat
  capture** toggle in Settings and a per-world **Remove chat mod** button let you
  disable the feature entirely and take the mod off a server — an easy way to
  back it out if a future Palworld update ever makes the mod misbehave.

## [1.3.0] — 2026-07-09

### Added
- **Global Downloads & updates center.** Installs and server updates no longer
  live in a modal you can accidentally lose. A permanent **Downloads** entry in
  the sidebar shows a live count and progress while work runs, and opens a full
  Downloads page listing every active job — with per-job progress bars, phase
  labels, and expandable SteamCMD logs — plus a history of completed and failed
  runs. World updates are now tracked jobs too, so an update finally shows real
  progress instead of a silent spinner.

### Fixed
- **SteamCMD "exited with code 7" no longer fails good installs.** SteamCMD very
  often exits non-zero after a fully successful run (most often when it updates
  itself mid-run and re-execs). Success is now judged by the install on disk
  (the server binary plus a readable build id), with an automatic single retry
  for the self-update case, instead of trusting the exit code alone.
- **Progress bar no longer sticks at 100% mid-update.** SteamCMD reports the
  bootstrapper self-update and the actual multi-GB server download in two
  different formats; only the first was understood, so the bar froze at 100%
  while the real download ran invisibly. Both formats are now parsed, the bar
  resets between phases, and each phase is labelled (Updating SteamCMD →
  Downloading server files → Verifying → Installing).

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
