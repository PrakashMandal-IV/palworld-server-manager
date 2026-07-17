# Changelog

All notable changes to Palworld Server Manager are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [2.4.0] — 2026-07-17

### At a glance
- Run a world from Discord with your own bot: start, stop, restart, broadcast, back up,
  check status, and kick someone — with a say over who may do which.
- Servers now start without the black command window — no more clutter next to the app.
- The app can now start itself when you log in to Windows or Linux — on by default.
- Fixed: deleting a server could delete the folder above it, taking other servers with it.

### Added
- **Run a world from Discord.** A new **Discord Bot** tab on each world sets up your own
  bot in four steps, giving you `/start`, `/stop`, `/restart`, `/broadcast`, `/backup`,
  `/status` and `/kick` in your Discord server. The Info page has a step-by-step guide to
  making the bot itself.

  It's your bot, not ours. You create it in Discord's developer portal and paste its
  token, which stays on this computer: it's never displayed again, never sent anywhere
  else, and you can revoke it from Discord whenever you like. The invite link asks for
  **no permissions at all** — the bot can't read messages and can't post on its own, it
  only ever answers its own commands. Everything runs from this app, so the commands work
  while it's open and stop when it closes.

  A Discord server is linked to a world with `/authorize`, which asks for the world's
  admin password in a private box only you can see. A slash command's options are shown
  to the whole channel, so a password could never be one of them. Five wrong tries locks
  that person out for fifteen minutes, and the bot only ever works in the one server you
  linked it to.

- **A say over who can do what.** Nobody can use the bot until you name them — an empty
  list means nobody, not everybody. Pick roles and people out of your Discord server's
  own lists, with their icons, avatars and display names, then tick per command: someone
  can be allowed to take a backup without being allowed to stop the server. Whoever runs
  `/authorize` gets everything, so a fresh setup is usable straight away.

  Listing people needs the **Server Members Intent** switched on for your bot; the panel
  says so and links to how, and you can always add someone by ID instead.

- **An activity log.** Every command anyone runs from Discord is recorded — including
  the ones that were refused, because "who tried to stop the server at 3am" is the
  question a log like this exists to answer. Filter it by date, person, command or
  outcome.

- **`/status`, for the whole channel.** "Is the server up?" is a question the channel
  has, so its answer goes to the channel rather than just whoever asked: a card with the
  world's name, whether it's up, the in-game day, uptime, player count and who's on, plus
  the server's name and the address people connect on from Settings → Server Identity.
  The gear on its column in the access grid picks which of those it gives away. The
  address appears once a Public IP is set there — left blank, the server works its own
  out and the app can't see what it lands on.

- **`/kick`, without hunting for an ID.** Pick whoever's playing from a list Discord
  fills in as you type, and see who's left afterwards. Only people allowed to kick can
  see that list.

- **Starts with Windows or Linux.** The app now offers to launch itself when you log
  in, so a server can come back up without you having to open the app first. It's on
  by default for new installs and for anyone updating from an earlier version;
  Settings → **Start automatically at login** turns it off. Windows registers this
  through its normal sign-in apps list; Linux drops a standard autostart entry for
  your desktop environment to pick up.

- **Servers start without a console window.** The black command window that opened
  beside the app is gone. It's on by default; if you read that window (it's the only
  place Palworld's raw server output shows up), Settings → **Hide the server console
  window** turns it back on.

  The window never came from how the app launched the server. Palworld ships the
  dedicated server as three programs: `PalServer.exe` is a small launcher, and the
  server itself is built twice — once as a windowed program and once as a console one.
  The launcher started the console build, and Windows gives a console program without a
  console of its own a real window. That window belonged to a program the app never
  launched directly, so no amount of "hide this window" on the app's side could reach
  it. Now the app just starts the windowed build itself. It's the same server — same
  ports, same REST API, same save data, and it still keeps running if you close the
  app. Servers whose folder doesn't have that build fall back to the launcher and start
  as before.

### Fixed
- **Deleting a server could wipe a whole folder of servers.** Reported in
  [#9](https://github.com/PrakashMandal-IV/palworld-server-manager/issues/9): a user
  with `PalworldServers\Main Server` and `PalworldServers\Testing Server` deleted the
  testing one and lost `PalworldServers` entirely — including the main server.

  This happened when a server was added with the **parent** folder picked as its
  install folder (easy to do — the Browse dialog opens on the parent, and SteamCMD
  installs into whatever folder you give it). That server's recorded folder was then
  `PalworldServers` itself, so deleting it with **also delete files** removed
  everything underneath, siblings included. Nothing checked the folder first.

  Two things changed. Deleting files is now refused when the folder holds another
  registered server, is a drive root, contains the app's own data or backups, or
  doesn't look like a Palworld server folder at all — the error names what's at risk,
  and deleting the profile alone still works. Separately, a folder that overlaps
  another server's is now rejected when you add or move a server, so the bad state
  can't be created in the first place. Existing servers already pointing at a parent
  folder are protected by the delete check.
- **A failed file delete no longer passes silently.** The profile used to disappear
  while the files stayed behind (e.g. locked by another process), with no error and no
  way to find them again. The delete now reports what went wrong and keeps the profile.

## [2.3.0] — 2026-07-15

### At a glance
- Live player map — see everyone online on the real Palworld map, no mod needed.
- Workshop mods: check for updates, update one or all, and see their thumbnails.
- Open any mod's folder in one click, with Workshop IDs shown next to package names.
- Force-enable mods published without server install rules.
- Schedule system messages and on-screen notices to players.
- New schedule triggers: every N minutes, or when a player joins (with a delay).
- Discord can now announce players joining and leaving.
- Update is only offered when there's actually a newer server build.
- Fixed: scheduled backups ran with the server stopped, evicting real backups.
- Fixed: upgrading to 2.1.0 silently switched Discord notifications back on.
- Fixed: the Update available badge never showed on a world's own page.

### Added
- **Live player map.** A new **Map** tab plots everyone online on the real Palworld
  world map (the current post-Feybreak one, bundled with the app — nothing to
  download). Scroll to zoom, drag to pan, and hover a player for their in-game
  coordinates. It works with the server's own REST API, so no game mod is needed. The
  map ships pre-calibrated; if you want to fine-tune it for yourself, calibrating from
  the Map tab changes only your install, and **Reset to default** puts it back.
- **Workshop mod update checks.** The Mods tab has a **Check for updates** button that
  compares each installed mod's `Info.json` version against Steam's copy of the same
  Workshop item. Anything out of date gets a badge showing the new version, plus an
  **Update** button per mod and an **Update all** for the lot — no more copying mod
  folders over by hand to keep up.
- **Workshop mod thumbnails.** Mods that ship preview art now show it in the list
  instead of the generic shield icon.
- **Jump to a mod's folder.** Every mod row has a button that opens its folder, and
  the panel has one for the Workshop root. Workshop mods also show their item ID next
  to the package name, so matching a folder to a mod no longer takes guesswork.
- **Force-enable mods that skip `IsServer`.** Some mods run fine on a dedicated server
  but were published without server install rules, which used to mean wiring them up
  manually. You can now enable them anyway after a confirmation that says what to
  expect: Lua mods get bridged into UE4SS and should just work, while Pak-only mods
  depend on Palworld's own deploy step and may not.
- **Scheduled messages to players.** The Schedule tab has two new job types beyond
  restart/backup/update: **System message** (posts as a System announcement in the
  in-game chat feed) and **On-screen notice** (pops on every player's screen through
  the broadcast mod, falling back to chat if the mod isn't set up). Each carries your
  own custom message.
- **More ways to time a schedule.** Alongside *Every N hours* and *Daily at time*,
  schedules can now run **Every N minutes**, and messages can fire **When a player
  joins**. The join trigger takes an optional player-name filter (blank = anyone), and
  you can drop `{player}` into the message to insert the joining player's name. It also
  takes a **Delay (s)** — wait a few seconds after someone joins so your welcome lands
  once they're actually in the world rather than on the loading screen. A delayed
  message is dropped if the player leaves, the server stops, or you remove the
  schedule before it fires.
- **On-screen setup nudge.** Picking *On-screen notice* without the broadcast mod
  installed now shows a clear notice with a one-click jump to the Broadcast tab to set
  it up (the notice still sends via chat until then).
- **Discord notifications when players join or leave.** The Discord tab's event list
  now includes **Player joined** and **Player left**, each routable to any of your
  webhook channels (or *Don't send*). They're off by default, so existing setups get
  no new noise. Join/leave is tracked by a background watcher, so the notifications
  fire even when the app window isn't open on that world.

### Changed
- **Update is only offered when there's an update.** Worlds now check Steam for a
  newer server build on their own (every six hours, plus whenever you press *Check for
  updates*). The **Update available** badge shows the moment one lands, and the Update
  button is hidden while your build is already current. If Steam can't be reached the
  button stays available rather than leaving you unable to update.
- **Clearer name for the supply drop setting.** *Supply drop interval (s)* in
  **Settings → World & Loot** is now **Meteor/Supply drop interval (s)**, matching what
  players actually see fall out of the sky.

### Fixed
- **Scheduled backups ran even with the server stopped.** A backup schedule fired on
  its interval whether or not the world was running, and a stopped world's save data
  can't change — so those backups were identical copies. Worse, since only the newest
  few backups are kept, a stopped server left running overnight would quietly evict
  every real backup you had. Scheduled backups now skip while a world is stopped (noted
  in its event log) and take the backup they owed you as soon as it's running again.
  Manual backups still work whether or not the server is up.
- **Upgrading to 2.1.0 silently switched Discord notifications back on.** Events you'd
  turned off before 2.1.0 were dropped when the old per-event switches became webhook
  routing, so notifications you'd deliberately silenced — a backup announcement every
  hour, say — started arriving again. Those switches are now carried across the
  upgrade. If you've already upgraded and are seeing this, set the event to *Don't
  send* on the world's Discord tab; that sticks.
- The **Update available** badge never appeared on a world's own page — the page was
  never told whether an update existed, so the badge could not render regardless of
  what Steam reported.

## [2.2.0] — 2026-07-14

### Added
- **The app now speaks your language.** Every screen, label, tab, and toast can be
  shown in a language other than English, chosen from **Settings → Language** and
  applied instantly (no restart). English ships built in; **Spanish, Japanese, and
  Chinese (Simplified)** are available as ready-made translations.
- **Community language packs, installed from inside the app.** Settings → Language
  lists translation packs hosted on the project's GitHub and lets you **install,
  update, and remove** each one with a single click — no files to download by hand and
  no visit to GitHub required. The list shows which packs are already installed and
  flags when a newer version is available.
- **Bring your own translation.** A new **Language packs** guide page (opened from the
  *Make your own* button on the language settings) explains the simple pack format,
  offers the English strings as a downloadable template, and lets you add your own pack
  by importing a `.json` file or pasting a link. Any label you don't translate falls
  back to English, so even a partial translation works. Untrusted packs are validated
  before they're saved.

## [2.1.0] — 2026-07-13

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

## [2.0.1] — 2026-07-12

### Fixed
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
