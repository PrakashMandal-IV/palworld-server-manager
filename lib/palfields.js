// lib/palfields.js
// AUTO-DERIVED from the real DefaultPalWorldSettings.ini (108 options, current Palworld).
// Managed network/auth keys are intentionally excluded (the app controls them).
// type: bool | int | float | text | select | tuple

const GROUPS = [
  {
    title: "General",
    fields: [
      { key: "Difficulty", label: "Difficulty", type: "select", default: "None", options: ["None","Casual","Normal","Hard"] },
      { key: "DeathPenalty", label: "Death penalty", type: "select", default: "All", options: ["None","Item","ItemAndEquipment","All"] },
      { key: "bHardcore", label: "Hardcore", type: "bool", default: false },
      { key: "bPalLost", label: "Pals lost on death (hardcore)", type: "bool", default: false },
      { key: "bCharacterRecreateInHardcore", label: "Recreate character (hardcore)", type: "bool", default: false },
      { key: "RandomizerType", label: "Randomizer type", type: "select", default: "None", options: ["None","Region","All"] },
      { key: "RandomizerSeed", label: "Randomizer seed", type: "text", default: "" },
      { key: "bIsRandomizerPalLevelRandom", label: "Randomize Pal levels", type: "bool", default: false },
    ],
  },
  {
    title: "Time & Rates",
    fields: [
      { key: "DayTimeSpeedRate", label: "Day speed", type: "float", default: 1 },
      { key: "NightTimeSpeedRate", label: "Night speed", type: "float", default: 1 },
      { key: "ExpRate", label: "EXP rate", type: "float", default: 1 },
      { key: "WorkSpeedRate", label: "Work speed", type: "float", default: 1 },
      { key: "MonsterFarmActionSpeedRate", label: "Ranch Pal work speed", type: "float", default: 1 },
      { key: "AutoSaveSpan", label: "Auto-save interval (s)", type: "float", default: 30 },
    ],
  },
  {
    title: "Pals",
    fields: [
      { key: "PalCaptureRate", label: "Capture rate", type: "float", default: 1 },
      { key: "PalSpawnNumRate", label: "Pal spawn rate", type: "float", default: 1 },
      { key: "PalDamageRateAttack", label: "Pal attack damage", type: "float", default: 1 },
      { key: "PalDamageRateDefense", label: "Pal defense", type: "float", default: 1 },
      { key: "PalStomachDecreaceRate", label: "Pal hunger drain", type: "float", default: 1 },
      { key: "PalStaminaDecreaceRate", label: "Pal stamina drain", type: "float", default: 1 },
      { key: "PalAutoHPRegeneRate", label: "Pal HP regen", type: "float", default: 1 },
      { key: "PalAutoHpRegeneRateInSleep", label: "Pal HP regen (sleep)", type: "float", default: 1 },
      { key: "PalEggDefaultHatchingTime", label: "Egg hatching time (h)", type: "float", default: 72 },
      { key: "EnablePredatorBossPal", label: "Predator boss Pals", type: "bool", default: true },
    ],
  },
  {
    title: "Players",
    fields: [
      { key: "PlayerDamageRateAttack", label: "Player attack damage", type: "float", default: 1 },
      { key: "PlayerDamageRateDefense", label: "Player defense", type: "float", default: 1 },
      { key: "PlayerStomachDecreaceRate", label: "Player hunger drain", type: "float", default: 1 },
      { key: "PlayerStaminaDecreaceRate", label: "Player stamina drain", type: "float", default: 1 },
      { key: "PlayerAutoHPRegeneRate", label: "Player HP regen", type: "float", default: 1 },
      { key: "PlayerAutoHpRegeneRateInSleep", label: "Player HP regen (sleep)", type: "float", default: 1 },
      { key: "ItemWeightRate", label: "Item weight rate", type: "float", default: 1 },
      { key: "BlockRespawnTime", label: "Respawn block time (s)", type: "float", default: 5 },
      { key: "RespawnPenaltyDurationThreshold", label: "Respawn penalty threshold", type: "float", default: 0 },
      { key: "RespawnPenaltyTimeScale", label: "Respawn penalty scale", type: "float", default: 2 },
    ],
  },
  {
    title: "Enhance Stats",
    fields: [
      { key: "bAllowEnhanceStat_Health", label: "Enhance: Health", type: "bool", default: true },
      { key: "bAllowEnhanceStat_Attack", label: "Enhance: Attack", type: "bool", default: true },
      { key: "bAllowEnhanceStat_Stamina", label: "Enhance: Stamina", type: "bool", default: true },
      { key: "bAllowEnhanceStat_Weight", label: "Enhance: Weight", type: "bool", default: true },
      { key: "bAllowEnhanceStat_WorkSpeed", label: "Enhance: Work speed", type: "bool", default: true },
    ],
  },
  {
    title: "World & Loot",
    fields: [
      { key: "CollectionDropRate", label: "Gather drop rate", type: "float", default: 1 },
      { key: "CollectionObjectHpRate", label: "Gatherable HP", type: "float", default: 1 },
      { key: "CollectionObjectRespawnSpeedRate", label: "Gatherable respawn", type: "float", default: 1 },
      { key: "EnemyDropItemRate", label: "Enemy drop rate", type: "float", default: 1 },
      { key: "DropItemMaxNum", label: "Max dropped items", type: "int", default: 3000 },
      { key: "DropItemMaxNum_UNKO", label: "Max dropped (UNKO)", type: "int", default: 100 },
      { key: "DropItemAliveMaxHours", label: "Dropped item lifetime (h)", type: "float", default: 1 },
      { key: "SupplyDropSpan", label: "Meteor/Supply drop interval (s)", type: "int", default: 180 },
      { key: "bEnableInvaderEnemy", label: "Raid invaders", type: "bool", default: true },
      { key: "bActiveUNKO", label: "Active UNKO", type: "bool", default: false },
      { key: "EquipmentDurabilityDamageRate", label: "Equipment durability loss", type: "float", default: 1 },
      { key: "ItemCorruptionMultiplier", label: "Item corruption rate", type: "float", default: 1 },
      { key: "DenyTechnologyList", label: "Denied technologies", type: "text", default: "" },
    ],
  },
  {
    title: "Building & Base Camps",
    fields: [
      { key: "BuildObjectHpRate", label: "Structure HP", type: "float", default: 1 },
      { key: "BuildObjectDamageRate", label: "Structure damage", type: "float", default: 1 },
      { key: "BuildObjectDeteriorationDamageRate", label: "Structure deterioration", type: "float", default: 1 },
      { key: "BaseCampMaxNum", label: "Max base camps", type: "int", default: 128 },
      { key: "BaseCampWorkerMaxNum", label: "Max workers/base", type: "int", default: 15, max: 50, hint: "Cap is 50. Higher values raise server load." },
      { key: "BaseCampMaxNumInGuild", label: "Max bases/guild", type: "int", default: 4 },
      { key: "MaxBuildingLimitNum", label: "Max buildings (0=off)", type: "int", default: 0 },
      { key: "bBuildAreaLimit", label: "Build area limit", type: "bool", default: false },
      { key: "bEnableBuildingPlayerUIdDisplay", label: "Show builder on structures", type: "bool", default: false },
    ],
  },
  {
    title: "Guilds",
    fields: [
      { key: "GuildPlayerMaxNum", label: "Max guild players", type: "int", default: 20 },
      { key: "bAutoResetGuildNoOnlinePlayers", label: "Auto-reset empty guilds", type: "bool", default: false },
      { key: "AutoResetGuildTimeNoOnlinePlayers", label: "Guild reset time (h)", type: "float", default: 72 },
      { key: "bEnableDefenseOtherGuildPlayer", label: "Defend vs other guilds", type: "bool", default: false },
      { key: "bCanPickupOtherGuildDeathPenaltyDrop", label: "Loot other guild drops", type: "bool", default: false },
      { key: "bInvisibleOtherGuildBaseCampAreaFX", label: "Hide other guild base FX", type: "bool", default: false },
      { key: "GuildRejoinCooldownMinutes", label: "Guild rejoin cooldown (m)", type: "int", default: 0 },
    ],
  },
  {
    title: "Multiplayer & PvP",
    fields: [
      { key: "bEnablePlayerToPlayerDamage", label: "PvP damage", type: "bool", default: false },
      { key: "bEnableFriendlyFire", label: "Friendly fire", type: "bool", default: false },
      { key: "bIsPvP", label: "PvP mode", type: "bool", default: false },
      { key: "bIsMultiplay", label: "Multiplay flag", type: "bool", default: false },
      { key: "CoopPlayerMaxNum", label: "Co-op max players", type: "int", default: 4 },
      { key: "ServerPlayerMaxNum", label: "Server max players", type: "int", default: 32 },
      { key: "bEnableNonLoginPenalty", label: "Non-login penalty", type: "bool", default: true },
      { key: "bEnableFastTravel", label: "Fast travel", type: "bool", default: true },
      { key: "bEnableFastTravelOnlyBaseCamp", label: "Fast travel: base only", type: "bool", default: false },
      { key: "bIsStartLocationSelectByMap", label: "Choose start on map", type: "bool", default: true },
      { key: "bExistPlayerAfterLogout", label: "Body persists after logout", type: "bool", default: false },
      { key: "bDisplayPvPItemNumOnWorldMap_BaseCamp", label: "Show PvP items on map (base)", type: "bool", default: false },
      { key: "bDisplayPvPItemNumOnWorldMap_Player", label: "Show PvP items on map (player)", type: "bool", default: false },
      { key: "bAdditionalDropItemWhenPlayerKillingInPvPMode", label: "Enable PvP kill drops", type: "bool", default: false },
      { key: "AdditionalDropItemWhenPlayerKillingInPvPMode", label: "PvP kill drop item", type: "text", default: "PlayerDropItem" },
      { key: "AdditionalDropItemNumWhenPlayerKillingInPvPMode", label: "PvP kill drop count", type: "int", default: 1 },
    ],
  },
  {
    title: "Voice Chat (1.0)",
    fields: [
      { key: "bEnableVoiceChat", label: "Enable proximity voice chat", type: "bool", default: false, hint: "New in Palworld 1.0. In-game voice is off by default; enable it and tune the audible distance below. Restart to apply." },
      { key: "VoiceChatMaxVolumeDistance", label: "Full-volume distance", type: "int", default: 800, hint: "Distance (cm) within which voice plays at full volume before it starts to fade." },
      { key: "VoiceChatZeroVolumeDistance", label: "Silence distance", type: "int", default: 2000, hint: "Distance (cm) beyond which voice can no longer be heard." },
    ],
  },
  {
    title: "Palbox & Crossplay",
    fields: [
      { key: "CrossplayPlatforms", label: "Crossplay platforms", type: "tuple", default: "(Steam,Xbox,PS5,Mac)" },
      { key: "bAllowGlobalPalboxExport", label: "Global Palbox export", type: "bool", default: true },
      { key: "bAllowGlobalPalboxImport", label: "Global Palbox import", type: "bool", default: false },
      { key: "bAllowClientMod", label: "Allow client mods", type: "bool", default: true },
    ],
  },
  {
    title: "Aim Assist & Backups",
    fields: [
      { key: "bEnableAimAssistPad", label: "Aim assist (pad)", type: "bool", default: true },
      { key: "bEnableAimAssistKeyboard", label: "Aim assist (keyboard)", type: "bool", default: false },
      { key: "bIsUseBackupSaveData", label: "Rolling save backups", type: "bool", default: true },
    ],
  },
  {
    title: "Server Identity",
    fields: [
      { key: "ServerName", label: "Server name", type: "text", default: "Default Palworld Server" },
      { key: "ServerDescription", label: "Description", type: "text", default: "" },
      { key: "PublicIP", label: "Public IP (for tunnels)", type: "text", default: "", hint: "Your public / tunnel IP (blank = auto-detect)." },
      { key: "PublicPort", label: "Public port (advertised)", type: "int", default: 8211, hint: "Your public / tunnel port (else the game port)." },
      { key: "Region", label: "Region", type: "text", default: "" },
      { key: "bUseAuth", label: "Require auth", type: "bool", default: true },
      { key: "BanListURL", label: "Ban list URL", type: "text", default: "https://b.palworldgame.com/api/banlist.txt" },
      { key: "bShowPlayerList", label: "Show player list", type: "bool", default: false },
      { key: "bIsShowJoinLeftMessage", label: "Show join/leave msgs", type: "bool", default: true },
      { key: "ChatPostLimitPerMinute", label: "Chat rate limit/min", type: "int", default: 30 },
      { key: "LogFormatType", label: "Log format", type: "select", default: "Text", options: ["Text","Json"] },
      { key: "ServerReplicatePawnCullDistance", label: "Pawn cull distance", type: "float", default: 15000 },
      { key: "ItemContainerForceMarkDirtyInterval", label: "Container sync interval", type: "float", default: 1 },
    ],
  },
];

function allFields(){return GROUPS.flatMap(g=>g.fields);}
function defaults(){const d={};for(const f of allFields())d[f.key]=f.default;return d;}
module.exports={GROUPS,allFields,defaults};
