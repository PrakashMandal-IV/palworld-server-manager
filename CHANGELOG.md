# Changelog

All notable changes to Palworld Server Manager are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [2.0.1] — 2026-07-12

### Added
- **Portable Windows build (no installation).** The release now ships a portable
  `.exe` alongside the installer. It runs with no install and keeps everything it
  writes — the worlds database, backups, SteamCMD, and logs — in a `PSM-Data` folder
  created right next to the executable, so nothing is left in `%AppData%`. Copy the
  `.exe` together with its `PSM-Data` folder to a USB stick or another PC and your
  whole setup travels with it. The installer build is unchanged and still stores its
  data in `%AppData%` as before.
- **Send different Discord events to different channels.** The Discord tab previously
  had a single webhook, so every notification went to one channel. You can now add
  several named webhook **channels** and route each event to whichever one you want —
  e.g. a **Status** channel for start/stop/restart/crash/update, a separate **Backup**
  channel, and a **Chat** channel for the in-game chat relay. Each event has a
  drop-down to pick its channel (or *Don't send* to mute it), and every channel has
  its own **Test** button. Upgrading is seamless: if you were already using the single
  Discord webhook, it's migrated to one channel named **Default Channel** with every
  event routed to it (and chat only if you had the relay on), so your notifications
  keep working with no reconfiguration. Worlds with no webhook are left untouched.

### Fixed
- **Player join/leave notices no longer flood the chat log and Discord (often in
  Japanese).** Palworld announces logins/logouts through the in-game chat channel with
  a synthetic **SYSTEM** sender, localized to the server's game language — so they
  appeared in the GUI chat log and were relayed to Discord as lines like
  `PlayerNameがログインしました。` ("… logged in"). These system broadcasts aren't real player
  chat and just duplicate the app's own Join/Leave history, so they're now filtered
  out of both the chat feed and the Discord relay. This takes effect for existing
  servers as soon as the app updates — no need to reinstall the chat relay mod — and
  the bundled mod was updated too so fresh installs never emit them.
- **Backups and crashes now actually post to Discord.** The Discord tab's *Notify
  on* list offered **backup** and **crash** toggles, but nothing was ever sent for
  those two events — creating a backup and a server crash both posted nothing, while
  start/stop/restart/update worked. Both are now wired up: manual and scheduled
  backups post a message (internal safety snapshots taken right before a
  restart/update/restore stay silent so they don't spam the channel), and an
  unexpected server exit posts a crash notice. Both still respect their *Notify on*
  toggles.
- **The manager no longer becomes unresponsive after a long session.** After the app
  had been running for an extended period, every action could start failing with
  "Request failed (500)" repeating every few seconds, with no button working until
  the app was force-closed. The packaged app's WASM SQLite backend keeps each
  prepared statement in memory until it is explicitly finalized, but the database
  layer created a fresh statement on every query and never released it — so routine
  background polling leaked statements until the database ran out of memory and every
  request failed. Prepared statements are now cached and reused for the life of the
  connection (and finalized on shutdown), keeping memory flat no matter how long the
  app runs. Your worlds and save data were never at risk from this — it only affected
  the manager's own bookkeeping database.
- **The connect address now shows your real network IP, not just `127.0.0.1`.** The
  Overview showed only `127.0.0.1:<port>`, which works *only* from the PC running the
  server — leading some to think the app forced the server to bind to loopback. It
  never did: the server listens on every network adapter. The panel now leads with
  your **Same network (LAN)** address (e.g. `192.168.31.243:8211`) that other PCs on
  your network use, clearly marks `127.0.0.1` as **This PC only**, lists your other
  adapters, and spells out that reaching it over the internet is a router
  port-forward/tunnel step. Local network adapters are ranked so your real
  Ethernet/Wi-Fi wins over virtual ones (Hyper-V, WSL, VPNs).
- **Ports could not be changed after a world was created.** The Admin tab showed a
  world's Game/Query/REST API/RCON ports as plain text — there was no way to give a
  world custom ports once it existed, even though the app supported it internally.
  These are now editable fields with a **Save ports** button (world must be stopped).
  Saving now also rejects invalid port numbers, a port already used by another
  world, and two of a world's own ports being set to the same value — previously
  these were accepted silently and could produce a broken configuration.

## [2.0.0] — 2026-07-12

### Added
- **Steam Workshop mods on any drive.** PSM now auto-detects every Steam library on
  the machine — reading the Steam registry entries and each `libraryfolders.vdf` — so
  a Workshop mod you've subscribed to is found no matter which drive Steam is
  installed on, not just `C:`. The Mods tab gained a **Steam library location**
  control that lists the detected libraries and lets you point at a specific folder
  (with a picker) if your setup is unusual.
- **Workshop ID help.** An **info** button next to *Add* opens a short guide: how to
  find a mod's Workshop ID (the number in its Steam URL), that the mod must be
  subscribed/downloaded in Steam first, and to use *Import mod (.zip)* otherwise.
- **Choose where backups are stored.** Settings → Backups now shows the exact folder
  backups are written to and lets you point them at any drive/folder (with a picker),
  or reset to the default. Existing backups stay put; only new ones use the new
  location. A world's **Backups** tab shows that world's backup folder and an **Open
  backup folder** button, so it's easy to find your saved snapshots. (Backups are ZIP
  copies of each world's *Saved* folder, kept outside the server install where a game
  update can't touch them.)

### Fixed
- **Workshop server mods are now correctly detected.** A mod's `Info.json`
  `InstallRule` is an array of per-target rules, but PSM read it as a single object —
  so every mod was wrongly flagged **"not a server mod"** and its enable toggle was
  locked. Any rule with `IsServer: true` now correctly marks a mod as server-side,
  and the mod's real `ModName` is shown.
- **Enabling a mod no longer corrupts `PalModSettings.ini`.** The reader matched
  `WorkshopRootDir` across line breaks, so an empty value swallowed the following
  line (e.g. `ConfigVersion=1.0`) and wrote a malformed file on the next save.
  Parsing is now strictly line-based and `ConfigVersion` is preserved.
- **Workshop *Lua* mods now actually load.** Palworld deploys Workshop Lua mods to
  `Mods/NativeMods/UE4SS/Mods`, which the bundled UE4SS (at
  `Pal/Binaries/Win64/ue4ss`) never scans — so most Workshop mods silently did
  nothing even after being enabled and deployed. Enabling a Lua-type Workshop mod now
  bridges its scripts into the running UE4SS mods folder (and tears them down on
  disable/remove), so it loads on the next server restart. Pak-only mods are
  unaffected.

## [1.5.0] — 2026-07-10

### Added
- **Broadcast section.** A new **Broadcast** tab lets you message everyone on the
  server: send an announcement immediately, or schedule messages for later. Each
  pending schedule shows a live **hh:mm:ss countdown** to when it fires; edit or
  delete them, and they're removed automatically once they fire. Schedules persist
  across app and system restarts, so one set for tomorrow still fires as long as the
  app is open when the time comes. If the app was closed through the scheduled time,
  the broadcast isn't fired late or lost — it's kept and flagged **Missed**, with
  one-click **Send now** and **Reschedule** actions. For a true on-screen message, install the bundled
  **PSMBroadcast** UE4SS mod from the tab — broadcasts then appear on every player's
  screen via the game's on-screen server notice (BroadcastServerNotice). Without the
  mod, delivery falls back to Palworld's REST announce, which shows in the chat feed. (The red pre-shutdown
  countdown look is exclusive to actual shutdowns and can't be triggered for a
  normal message.)
- **Pre-shutdown warning countdown.** Each world can now warn players in-game
  before a restart or update — scheduled *or* manual. Configure it in the
  **Schedule** tab: how many minutes ahead to start, how often to repeat, and a
  custom message with `{minutes}` / `{seconds}` placeholders (e.g. *"The server
  will restart in {minutes} minute(s)"*). The notices go to everyone on the server —
  on-screen via the PSMBroadcast mod when it's installed, otherwise as a chat-feed
  announce — then hand off to Palworld's native red shutdown countdown for the final
  minute. Manual restarts with a warning run in the background so the app stays
  responsive during the countdown.
- **In-app INI editor with version history.** A **.ini Editor** button in the
  Settings tab opens `PalWorldSettings.ini` in a full-screen editor so you can
  tweak raw settings directly. Every save and restore snapshots the file, so you
  can view any past version and roll back to it in one click. Closing or
  restoring with unsaved edits prompts you to discard first, and edits are
  reflected back into the Settings form (both read the same file).
- **Player join password.** You can now set a **Server password** in the Admin
  tab — the password players type on Palworld's join screen (separate from the
  admin password). Leave it blank for an open server.
- **Palworld 1.0 settings.** Added the new 1.0 server options, including a
  **Voice Chat** group (enable proximity voice chat and tune its full-volume /
  silence distances), plus *Ranch Pal work speed* and *Show builder on
  structures*.
- **Public IP / port for tunnels.** Server Identity now has editable **Public IP**
  and **Public port** fields — the address advertised in the community server
  browser. Set them to your tunnel's public IP and port (e.g. playit.gg) so
  friends, including console/PS5 players, can find and join a server that has no
  real public IP. They default to auto-detect / the game port, and a routine
  profile save no longer overwrites a custom tunnel port.

### Fixed
- **Updating an adopted server no longer fails when SteamCMD is missing.** Worlds
  added from an existing install never ran provisioning, so SteamCMD wasn't
  present and updates errored out. Updates now install SteamCMD automatically
  first if it isn't already there.
- **App logo/favicon no longer breaks.** Two copies of the icon both claimed the
  `/icon.png` URL, which made the sidebar logo and favicon fail to load. Resolved
  the collision so the icon shows reliably.

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
