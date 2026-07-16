// lib/discordbot.js
// Runs a user's own Discord bot for a world, so they can drive the server from Discord.
//
// The bot holds a gateway connection for as long as the app is open — Discord pushes
// interactions down it, which is the only way to receive commands without a public URL
// to POST to. Close the app and the commands stop working; there's nothing listening.
//
// Shape of the trust model:
//   - The user makes their own bot and pastes its token. We never see it, they can
//     revoke it, and it only ever touches their machine.
//   - The bot is invited with permissions=0. It cannot read messages, cannot post
//     unprompted, cannot see members. It answers interactions and nothing else.
//   - A guild is linked to a world by running /authorize and typing the world's admin
//     password into a modal. Discord shows slash-command *options* to the whole
//     channel, so a password can never be an option — the modal is what keeps it
//     private. Only the invoker ever sees what they typed.
//   - After that, only the roles/users on the allowlist may run anything.
const crypto = require("crypto");
const dbm = require("./db");
const sup = require("./supervisor");
const rest = require("./restclient");
const backups = require("./backups");
const cfgLib = require("./discord-bot-config");

const API = "https://discord.com/api/v10";

// Live clients, one per world, kept on the global so hot-reload doesn't strand a
// gateway socket (the same trick supervisor.js uses for child processes).
const g = globalThis;
if (!g.__PAL_BOTS) {
  g.__PAL_BOTS = {
    clients: new Map(),  // world_id -> discord.js Client
    tokens: new Map(),   // world_id -> token the client was started with
    attempts: new Map(), // `${world_id}:${user_id}` -> { count, until }
    starting: new Map(), // world_id -> in-flight startBot promise
  };
}
const B = g.__PAL_BOTS;
// Older instances of this module may predate `starting` (hot reload keeps the object).
if (!B.starting) B.starting = new Map();

// ---- authorize brute-force guard -------------------------------------------------
// The admin password is the only thing standing between a guild member and control of
// the server, and Discord lets anyone in the guild run /authorize. Without a limit,
// the modal is an unlimited password oracle.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function attemptKey(worldId, userId) { return `${worldId}:${userId}`; }

function lockedOutFor(worldId, userId) {
  const a = B.attempts.get(attemptKey(worldId, userId));
  if (!a || a.count < MAX_ATTEMPTS) return 0;
  const left = a.until - Date.now();
  if (left <= 0) { B.attempts.delete(attemptKey(worldId, userId)); return 0; }
  return left;
}

function noteFailure(worldId, userId) {
  const k = attemptKey(worldId, userId);
  const a = B.attempts.get(k) || { count: 0, until: 0 };
  a.count += 1;
  a.until = Date.now() + LOCKOUT_MS;
  B.attempts.set(k, a);
  return MAX_ATTEMPTS - a.count;
}

function clearFailures(worldId, userId) { B.attempts.delete(attemptKey(worldId, userId)); }

// Compare without leaking length or position through timing. Hashing first keeps
// timingSafeEqual happy on differing lengths.
function sameSecret(a, b) {
  const ha = crypto.createHash("sha256").update(String(a ?? ""), "utf8").digest();
  const hb = crypto.createHash("sha256").update(String(b ?? ""), "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---- token / app identity --------------------------------------------------------

// Confirm a pasted token really is a bot token and find out which application it is,
// which is what the invite link needs. Returns { ok, appId, username } — never throws
// the token into an error message.
async function validateToken(token) {
  const headers = { Authorization: `Bot ${String(token || "").trim()}` };
  try {
    const me = await fetch(`${API}/users/@me`, { headers });
    if (me.status === 401) return { ok: false, error: "Discord rejected that token. Copy it again from the Bot page — it's shown only once, and resetting it invalidates the old one." };
    if (!me.ok) return { ok: false, error: `Discord returned ${me.status} while checking the token.` };
    const user = await me.json();
    const appRes = await fetch(`${API}/oauth2/applications/@me`, { headers });
    const app = appRes.ok ? await appRes.json() : null;
    return {
      ok: true,
      appId: String((app && app.id) || user.id || ""),
      username: String(user.username || ""),
    };
  } catch (e) {
    return { ok: false, error: `Couldn't reach Discord: ${e.message}` };
  }
}

// ---- slash command definitions ---------------------------------------------------
// Registered per guild, which Discord applies instantly (global commands can take an
// hour to appear). /authorize deliberately takes no options: its input is a password,
// and options are public.
function commandDefs() {
  return [
    { name: "authorize", description: "Link this server to your Palworld world (asks for the admin password privately)", type: 1 },
    { name: "start", description: "Start the Palworld server", type: 1 },
    { name: "stop", description: "Stop the Palworld server", type: 1 },
    { name: "restart", description: "Restart the Palworld server", type: 1 },
    { name: "backup", description: "Take a backup right now", type: 1 },
    {
      name: "broadcast",
      description: "Show a message to everyone on the server",
      type: 1,
      options: [{ name: "message", description: "What to say", type: 3, required: true, max_length: 200 }],
    },
  ];
}

async function registerCommands(token, appId, guildId) {
  const res = await fetch(`${API}/applications/${appId}/guilds/${guildId}/commands`, {
    method: "PUT",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commandDefs()),
  });
  if (!res.ok) throw new Error(`command registration failed (${res.status})`);
  return true;
}

// ---- config persistence ----------------------------------------------------------

function readConfig(worldId) {
  return cfgLib.normalizeBotConfig(dbm.getWorld(worldId));
}

function writeConfig(worldId, patch) {
  const next = { ...readConfig(worldId), ...patch };
  dbm.updateWorld(worldId, { discord_bot: JSON.stringify(next) });
  return next;
}

// ---- command execution -----------------------------------------------------------

// Mirror of the broadcast route: on-screen via the mod when it's installed, else the
// REST announce into the chat feed.
async function deliverBroadcast(world, message) {
  if (sup.broadcastModInstalled(world.install_dir)) {
    sup.enqueueBroadcast(world.install_dir, message);
    return "on screen";
  }
  await rest.announce(world, message);
  return "in chat";
}

// Run one command. Returns the line to show the invoker. Throws on failure; the caller
// turns that into an ephemeral error.
async function runCommand(name, worldId, interaction) {
  const world = dbm.getWorld(worldId);
  if (!world) throw new Error("That world no longer exists in the app.");

  if (name === "start") {
    if (sup.isAlive(worldId)) return `**${world.display_name}** is already running.`;
    await sup.startWorld(worldId);
    return `Starting **${world.display_name}**.`;
  }
  if (name === "stop") {
    if (!sup.isAlive(worldId)) return `**${world.display_name}** is already stopped.`;
    await sup.stopWorld(worldId, { graceful: true });
    return `Stopped **${world.display_name}**.`;
  }
  if (name === "restart") {
    await sup.restartWorld(worldId);
    return `Restarted **${world.display_name}**.`;
  }
  if (name === "backup") {
    const b = await backups.createBackup(worldId);
    return `Backup taken${b && b.file ? `: \`${String(b.file).split(/[\\/]/).pop()}\`` : "."}`;
  }
  if (name === "broadcast") {
    if (!sup.isAlive(worldId)) throw new Error("The server is stopped, so there's nobody to tell.");
    const message = interaction.options.getString("message", true);
    const how = await deliverBroadcast(world, message);
    return `Sent ${how}.`;
  }
  throw new Error(`Unknown command: ${name}`);
}

// ---- interaction handling --------------------------------------------------------

const AUTH_MODAL = "psm-authorize";
const AUTH_FIELD = "password";

function roleIdsOf(interaction) {
  try { return [...interaction.member.roles.cache.keys()]; } catch { return []; }
}

// Decide whether an interaction may run this one action, and say why not in a way that
// helps without telling an outsider anything useful about the setup.
function gate(cfg, interaction, action) {
  if (!interaction.guildId) return "These commands only work inside a Discord server.";
  // Authorization binds one guild. A bot invited elsewhere gets nothing, even with a
  // valid token, so a leaked invite can't reach someone else's server.
  if (!cfg.guildId || !cfg.authorizedAt) return "This server isn't linked to a Palworld world yet. Someone with the admin password needs to run `/authorize` first.";
  if (interaction.guildId !== cfg.guildId) return "This bot is linked to a different Discord server.";

  if (!cfgLib.isAllowed(cfg, action, interaction.user.id, roleIdsOf(interaction))) {
    // Permissions are per action now, so "you can't" is usually wrong — tell them what
    // they *can* do, which turns a dead end into a useful answer.
    const can = cfgLib.actionsFor(cfg, interaction.user.id, roleIdsOf(interaction));
    if (can.length) return `You're not allowed to use \`/${action}\`. You can use: ${can.map((a) => `\`/${a}\``).join(", ")}.`;
    return "You're not allowed to use this bot. Ask whoever set it up to grant your role or account in Palworld Server Manager → the world → Discord Bot.";
  }
  return null;
}

async function handleAuthorizeModal(worldId, interaction) {
  const world = dbm.getWorld(worldId);
  if (!world) return interaction.reply({ content: "That world no longer exists.", flags: EPHEMERAL });

  const left = lockedOutFor(worldId, interaction.user.id);
  if (left) {
    return interaction.reply({
      content: `Too many failed attempts. Try again in ${Math.ceil(left / 60000)} minute(s).`,
      flags: EPHEMERAL,
    });
  }

  const typed = interaction.fields.getTextInputValue(AUTH_FIELD);
  const expected = world.admin_password || "";
  // An empty admin password would otherwise authorize anyone who submits a blank box.
  if (!expected) {
    return interaction.reply({ content: "This world has no admin password set, so it can't be linked. Set one in the app (world → Admin) first.", flags: EPHEMERAL });
  }
  if (!sameSecret(typed, expected)) {
    const remaining = noteFailure(worldId, interaction.user.id);
    // A run of these is what someone guessing at the admin password looks like.
    dbm.logDiscordAction({
      worldId, action: "authorize", userId: interaction.user.id,
      userName: interaction.user.tag || interaction.user.username || "",
      guildId: interaction.guildId || "", result: "denied",
      detail: `Wrong password (${Math.max(remaining, 0)} attempt(s) left)`,
    });
    return interaction.reply({
      content: remaining > 0 ? `That password didn't match. ${remaining} attempt(s) left.` : "That password didn't match. Too many attempts — locked for 15 minutes.",
      flags: EPHEMERAL,
    });
  }

  clearFailures(worldId, interaction.user.id);
  const cfg = readConfig(worldId);
  writeConfig(worldId, {
    guildId: interaction.guildId,
    guildName: interaction.guild ? interaction.guild.name : "",
    authorizedAt: Date.now(),
    authorizedBy: interaction.user.id,
    // Whoever proved they know the admin password gets every action, otherwise linking
    // the bot would leave nobody able to use it. Everyone else is granted from the app,
    // one action at a time.
    permissions: cfgLib.grantAll(cfg.permissions, "user", interaction.user.id),
  });
  dbm.logDiscordAction({
    worldId, action: "authorize", userId: interaction.user.id,
    userName: interaction.user.tag || interaction.user.username || "",
    guildId: interaction.guildId, result: "ok",
    detail: `Linked ${interaction.guild ? interaction.guild.name : ""}`.trim(),
  });

  const world2 = dbm.getWorld(worldId);
  return interaction.reply({
    content: `Linked to **${world2.display_name}**. You can now use \`/start\`, \`/stop\`, \`/restart\`, \`/broadcast\` and \`/backup\`.\nOnly you can use them so far — add roles or people in the app under the world's **Discord Bot** tab.`,
    flags: EPHEMERAL,
  });
}

async function handleInteraction(worldId, interaction) {
  const cfg = readConfig(worldId);

  if (interaction.isModalSubmit && interaction.isModalSubmit() && interaction.customId === AUTH_MODAL) {
    return handleAuthorizeModal(worldId, interaction);
  }
  if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return;

  const name = interaction.commandName;

  if (name === "authorize") {
    if (!interaction.guildId) return interaction.reply({ content: "Run this inside your Discord server.", flags: EPHEMERAL });
    if (cfg.guildId && cfg.authorizedAt && interaction.guildId !== cfg.guildId) {
      return interaction.reply({ content: "This bot is already linked to a different Discord server. Unlink it in the app first.", flags: EPHEMERAL });
    }
    const left = lockedOutFor(worldId, interaction.user.id);
    if (left) return interaction.reply({ content: `Too many failed attempts. Try again in ${Math.ceil(left / 60000)} minute(s).`, flags: EPHEMERAL });

    // A modal, not a command option: Discord shows options to the whole channel, and
    // this one is a password. What's typed here is only ever seen by the person typing.
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = lazyDiscord();
    const modal = new ModalBuilder().setCustomId(AUTH_MODAL).setTitle("Link this server");
    const input = new TextInputBuilder()
      .setCustomId(AUTH_FIELD)
      .setLabel("World admin password")
      .setPlaceholder("From the world's Admin tab in the app")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(200);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Everything below is recorded, refusals included: an audit trail that only shows
  // what succeeded can't answer "who tried to stop the server at 3am".
  const who = {
    worldId,
    action: name,
    userId: interaction.user.id,
    userName: interaction.user.tag || interaction.user.username || "",
    guildId: interaction.guildId || "",
  };

  const denied = gate(cfg, interaction, name);
  if (denied) {
    dbm.logDiscordAction({ ...who, result: "denied", detail: denied });
    return interaction.reply({ content: denied, flags: EPHEMERAL });
  }

  // Starting or restarting a world takes far longer than the 3 seconds Discord allows
  // for a first response, so acknowledge now and fill it in when the work finishes.
  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    const msg = await runCommand(name, worldId, interaction);
    const detail = name === "broadcast" ? interaction.options.getString("message") || "" : "";
    dbm.logDiscordAction({ ...who, result: "ok", detail });
    dbm.logEvent(worldId, "discord", `/${name} run by ${who.userName || who.userId} from Discord`);
    await interaction.editReply({ content: msg });
  } catch (e) {
    dbm.logDiscordAction({ ...who, result: "error", detail: e.message });
    await interaction.editReply({ content: `Couldn't do that: ${e.message}` });
  }
}

// ---- gateway lifecycle -----------------------------------------------------------

// Required lazily so a missing/broken dependency can't stop the whole app from booting
// — a bot that won't connect must never take the server manager down with it.
function lazyDiscord() { return require("discord.js"); }

// discord.js exports the ephemeral flag; fall back to the documented value so this
// module can still be reasoned about (and unit-tested) without the dep present.
let EPHEMERAL = 64;
try { EPHEMERAL = lazyDiscord().MessageFlags.Ephemeral; } catch { /* 1 << 6 */ }

async function stopBot(worldId) {
  const client = B.clients.get(worldId);
  B.clients.delete(worldId);
  B.tokens.delete(worldId);
  if (client) { try { await client.destroy(); } catch { /* already gone */ } }
  return true;
}

// Connect a world's bot. Safe to call repeatedly: it no-ops when the same token is
// already connected, and reconnects when the token changed.
async function startBot(worldId) {
  const cfg = readConfig(worldId);
  if (!cfg.enabled || !cfg.token) return { started: false, reason: "not configured" };
  if (B.clients.has(worldId) && B.tokens.get(worldId) === cfg.token) return { started: false, reason: "already running" };

  // Connecting takes a few seconds, and callers poll. The "already running" check above
  // can't see a connection that is still logging in — the client isn't recorded until
  // login resolves — so without this every poll in that window would open ANOTHER
  // gateway session on the same token. Discord then delivers each interaction to both
  // sessions: they race to answer it, one wins, and the loser fails with "Unknown
  // interaction" while the user just sees "Something went wrong. Try again."
  const inFlight = B.starting.get(worldId);
  if (inFlight) return inFlight;

  const p = connect(worldId, cfg);
  B.starting.set(worldId, p);
  try { return await p; } finally { B.starting.delete(worldId); }
}

async function connect(worldId, cfg) {
  await stopBot(worldId);

  const { Client, GatewayIntentBits, Events } = lazyDiscord();
  // Guilds is the only intent, and it's not privileged: it's how we learn the bot was
  // added to a server so we can register the commands there. Interactions arrive
  // regardless of intents, so the bot never needs to read messages or see members —
  // which is also why nothing has to be switched on in the developer portal.
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on(Events.InteractionCreate, (i) => {
    handleInteraction(worldId, i).catch((e) => {
      dbm.logEvent(worldId, "discord", `Discord command failed: ${e.message}`);
    });
  });

  // The moment it's invited, put the commands in that server so /authorize is there
  // to be found. Guild commands show up instantly; global ones can take an hour.
  client.on(Events.GuildCreate, (guild) => {
    registerCommands(cfg.token, cfg.appId, guild.id)
      .then(() => dbm.logEvent(worldId, "discord", `Bot added to "${guild.name}" — commands registered`))
      .catch((e) => dbm.logEvent(worldId, "discord", `Bot added to "${guild.name}" but commands failed: ${e.message}`));
  });

  // guildCreate only fires for servers joined *while we're connected*. Servers the bot
  // was already in arrive as part of the initial sync and fire nothing, so on every
  // connect we (re)register everywhere it lives. Without this, inviting the bot and
  // then restarting the app leaves a server with no /authorize and no way to get it.
  client.once(Events.ClientReady, async () => {
    const guilds = [...client.guilds.cache.values()];
    // Say so out loud. A bot that's connected but in no server looks completely fine
    // from the app while nothing works in Discord — there's simply nowhere for the
    // commands to live, and that's invisible unless we report it.
    if (!guilds.length) {
      dbm.logEvent(worldId, "discord", "Bot is online but not in any Discord server yet — use the invite link to add it");
      return;
    }
    for (const guild of guilds) {
      try {
        await registerCommands(cfg.token, cfg.appId, guild.id);
        dbm.logEvent(worldId, "discord", `Commands ready in "${guild.name}"`);
      } catch (e) {
        dbm.logEvent(worldId, "discord", `Couldn't register commands in "${guild.name}": ${e.message}`);
      }
    }
  });

  client.on(Events.Error, (e) => dbm.logEvent(worldId, "discord", `Bot connection error: ${e.message}`));

  try {
    await client.login(cfg.token);
  } catch (e) {
    await stopBot(worldId);
    // Never let the raw error through: discord.js puts the token in some of them.
    const why = /token/i.test(e.message) ? "Discord rejected the bot token" : "couldn't connect to Discord";
    dbm.logEvent(worldId, "discord", `Bot failed to start: ${why}`);
    return { started: false, reason: why };
  }

  B.clients.set(worldId, client);
  B.tokens.set(worldId, cfg.token);
  dbm.logEvent(worldId, "discord", `Bot online as ${cfg.botUsername || "bot"}`);
  return { started: true };
}

function botStatus(worldId) {
  const client = B.clients.get(worldId);
  const connected = !!client && client.isReady && client.isReady();
  return {
    connected,
    // How many Discord servers it's actually in. Connected-but-in-nothing is the state
    // where the app looks healthy and Discord does nothing, so the UI needs to see it.
    guilds: connected ? client.guilds.cache.size : 0,
  };
}

// Bring every configured bot up; called on boot and after config changes.
function ensureBots() {
  for (const w of dbm.listWorlds()) {
    const cfg = cfgLib.normalizeBotConfig(w);
    if (cfg.enabled && cfg.token) startBot(w.world_id).catch(() => {});
  }
}

module.exports = {
  validateToken, registerCommands, commandDefs,
  readConfig, writeConfig,
  sameSecret, lockedOutFor, noteFailure, clearFailures,
  runCommand, deliverBroadcast,
  startBot, stopBot, botStatus, ensureBots, handleInteraction, gate,
  MAX_ATTEMPTS, LOCKOUT_MS,
  _state: B,
};
