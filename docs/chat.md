# In-game chat capture & Discord relay — research and design

## The problem

Earlier versions shipped a Chat tab that parsed `[CHAT] <name> message` lines from the
Palworld dedicated server's **stdout**. It never worked and was removed in v1.3.0.

The reason, confirmed by research:

- Pocketpair ships the dedicated server **without Unreal's log output enabled**. The
  server writes to stdout and discards it; there is no `Pal/Saved/Logs/` by default.
- **In-game chat is never emitted to stdout.**
- The official **REST API has no endpoint for chat** (only info, players, metrics,
  settings, announce, kick, ban, save, shutdown).
- The deprecated RCON protocol does not stream chat either.

So there is nothing to parse from the process output. Any real chat capture has to come
from inside the game via a mod.

Sources:
- ChatLogger (Nexus 778) — UE4SS mod that writes chat to a file; confirmed working on
  dedicated servers.
- Server Logging mod (Nexus 2379), Discord Integration / Event Logs (Nexus 2676),
  Xyro CrossChat (Nexus 3101) — community mods that relay chat to Discord webhooks.
- Palworld Modding Docs — the chat hook is
  `/Script/Pal.PalGameStateInGame:BroadcastChatMessage`, with the text read via
  `ChatMessage.Message:ToString()`.
- All require **UE4SS** (the experimental Palworld build) installed on the server.

## The design

Rather than depend on a third-party mod's private log format, the app ships its own tiny
UE4SS Lua mod so it controls both ends of the pipe.

```
 Palworld server  ─┐
   (UE4SS)         │  hooks BroadcastChatMessage
   PSMChatRelay ───┼─▶ appends JSON line ─▶ <install>/Pal/Saved/psm-chat.jsonl
                    │
 Server Manager  ──┴─▶ tails the .jsonl ─▶ in-app Chat tab (SSE)
                                        └▶ optional Discord webhook relay
```

### Mod (`resources/mods/PSMChatRelay`)

A UE4SS Lua mod that registers a hook on
`/Script/Pal.PalGameStateInGame:BroadcastChatMessage`, reads the sender, category and
message, and appends one JSON object per line to `Pal/Saved/psm-chat.jsonl`.

The output path is **baked in as an absolute path by the app's installer** rather than
resolved relative to UE4SS's working directory. This matters because UE4SS's working
directory differs between layouts (`Pal/Binaries/Win64/ue4ss` on 3.x, `Pal/Binaries/Win64`
on 2.x); a hard-coded relative path silently wrote to the wrong folder. The mod still
falls back to relative candidates for both layouts when installed by hand.

Line format:

```json
{"name":"Frenzi","channel":"Global","message":"hello","at":1751990148000}
```

### App

- `lib/supervisor.js` starts a **file tailer** for a world when it starts and stops it
  when the world stops. The tailer tracks a byte offset, reads appended lines, parses
  each as JSON (falling back to the legacy text parser so third-party ChatLogger-style
  logs still work), and feeds them into the existing `recordChat` pipeline.
- `recordChat` keeps the in-memory ring buffer and SSE broadcast (unchanged) and now
  also relays to Discord when enabled.
- The Chat tab is restored, shows live messages, an announce box, whether the relay mod
  is detected, and a one-click installer that copies the bundled mod into the server.

### Discord relay

Gated by a global setting `discordRelayChat`. When on and a webhook is configured, each
captured message is posted to the webhook as the player's name, giving a Palworld→Discord
cross-chat feed. Reuses `lib/notify.post`.

## Setup for users

1. Install **UE4SS** (experimental Palworld build) into the server —
   `Pal/Binaries/Win64`.
2. In the app, open the world → **Chat** tab → **Install chat relay mod**. The installer
   copies `PSMChatRelay` into the Mods folder this UE4SS build actually scans —
   `Pal/Binaries/Win64/ue4ss/Mods` on UE4SS 3.x, or `Pal/Binaries/Win64/Mods` on 2.x.
3. **Restart the world** (UE4SS loads mods only at startup). Player chat now appears in
   the Chat tab. On load, UE4SS.log prints `[PSMChatRelay] loaded` and the mod creates
   `Pal/Saved/psm-chat.jsonl`.
4. (Optional) enable **Relay chat to Discord** in Settings with a webhook set.

## Limits / notes

- Requires UE4SS, which is a third-party tool the app does not redistribute.
- The hooked function name can change with Palworld updates; the mod is small and easy
  to adjust if a future build renames it.
- Sending *into* the game as a player isn't supported by the REST API, so admin messages
  still go out as a server-wide announcement (broadcast).
