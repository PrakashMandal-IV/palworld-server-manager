-- PSMChatRelay — Palworld Server Manager chat relay
--
-- Hooks the server's chat broadcast and appends every message as one JSON line to
--   Pal/Saved/psm-chat.jsonl
-- which the Palworld Server Manager app tails to display chat and relay it to Discord.
--
-- Requires UE4SS (experimental Palworld build) in Pal/Binaries/Win64.
--
-- Output path: the app's installer rewrites the placeholder below with an absolute
-- path to <install>/Pal/Saved/psm-chat.jsonl, so this works regardless of which
-- directory UE4SS runs from. If the mod is installed by hand (placeholder left as-is)
-- we fall back to relative candidates covering both known UE4SS layouts:
--   * UE4SS 3.x  → working dir is Pal/Binaries/Win64/ue4ss  (3 levels up to Pal)
--   * UE4SS 2.x  → working dir is Pal/Binaries/Win64         (2 levels up to Pal)

-- Candidate output paths, tried in order; first one that opens is cached.
local CANDIDATES = {
    [[__PSM_OUT_PATH__]],            -- absolute, rewritten by the app installer
    "../../../Saved/psm-chat.jsonl", -- UE4SS 3.x layout (cwd = Win64/ue4ss)
    "../../Saved/psm-chat.jsonl",    -- UE4SS 2.x layout (cwd = Win64)
    "./psm-chat.jsonl",              -- last resort: next to UE4SS
}

local OUT_PATH = nil

-- Resolve (and cache) the first candidate path we can actually open for append.
local function resolve_out_path()
    if OUT_PATH then return OUT_PATH end
    for _, p in ipairs(CANDIDATES) do
        -- Skip the templated placeholder if the installer didn't rewrite it.
        -- The placeholder starts with "__"; no real absolute or relative path does.
        if p:sub(1, 2) ~= "__" then
            local f = io.open(p, "a")
            if f then
                f:close()
                OUT_PATH = p
                print(string.format("[PSMChatRelay] writing chat to: %s\n", p))
                return OUT_PATH
            end
        end
    end
    return nil
end

-- Minimal JSON string escaping (quotes, backslashes, control chars).
local function esc(s)
    s = tostring(s or "")
    s = s:gsub("\\", "\\\\"):gsub('"', '\\"')
    s = s:gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t")
    return s
end

local function now_ms()
    return math.floor(os.time() * 1000)
end

local function append_line(name, channel, message)
    local path = resolve_out_path()
    if not path then return end
    local ok, f = pcall(io.open, path, "a")
    if not ok or not f then
        OUT_PATH = nil -- drop the cache so we re-resolve next time
        return
    end
    local line = string.format(
        '{"name":"%s","channel":"%s","message":"%s","at":%d}\n',
        esc(name), esc(channel), esc(message), now_ms()
    )
    f:write(line)
    f:close()
end

-- Safely turn a UE FString/FText field into a Lua string.
local function to_str(v)
    if v == nil then return "" end
    local ok, s = pcall(function() return v:ToString() end)
    if ok and s then return s end
    return tostring(v)
end

-- Map the chat category enum to a readable channel name; best-effort.
local function channel_name(cat)
    local n = tonumber(cat)
    local map = { [0] = "Global", [1] = "Local", [2] = "Guild", [3] = "Whisper" }
    if n and map[n] then return map[n] end
    return "Global"
end

local function on_chat(self, chat_message_param)
    local ok = pcall(function()
        local msg = chat_message_param:get()
        local text = to_str(msg.Message)
        if text == "" then return end
        local name = to_str(msg.SenderName)
        if name == "" then name = to_str(msg.SenderPlayerName) end
        if name == "" then name = "Player" end
        append_line(name, channel_name(msg.Category), text)
    end)
    if not ok then
        -- swallow errors so a game update that changes the struct can't crash the server
    end
end

RegisterHook("/Script/Pal.PalGameStateInGame:BroadcastChatMessage", on_chat)

-- Resolve the output path eagerly so any path problems surface in UE4SS.log at load.
resolve_out_path()
print("[PSMChatRelay] loaded — hooking BroadcastChatMessage\n")
