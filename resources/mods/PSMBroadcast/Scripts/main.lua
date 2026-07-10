-- PSMBroadcast — Palworld Server Manager on-screen broadcast
--
-- The reverse of PSMChatRelay: instead of reading chat out of the game, this mod
-- reads broadcast messages the app *writes* and shows them to every player using the
-- server's on-screen system announce.
--
-- The app appends one JSON line per message to
--   Pal/Saved/psm-broadcast.jsonl
-- as {"b64":"<base64 utf-8 message>","at":<ms>}. This mod tails that file and, for
-- each new line, shows it on every player's screen via
--   PalGameStateInGame:BroadcastServerNotice(Message)
-- (the game's on-screen server notice — the same channel the "BroadcastServerNotice"
-- community mod used), reached through PalUtility:GetPalGameStateInGame(World). The
-- message is base64-encoded on the wire so quotes, newlines and unicode can never
-- break the line format or the parser.
--
-- Requires UE4SS (experimental Palworld build) in Pal/Binaries/Win64.
--
-- Queue path: the app's installer rewrites the placeholder below with an absolute
-- path to <install>/Pal/Saved/psm-broadcast.jsonl, so this works regardless of which
-- directory UE4SS runs from. If installed by hand (placeholder left as-is) we fall
-- back to relative candidates covering both known UE4SS layouts:
--   * UE4SS 3.x  → working dir is Pal/Binaries/Win64/ue4ss  (3 levels up to Pal)
--   * UE4SS 2.x  → working dir is Pal/Binaries/Win64         (2 levels up to Pal)

local CANDIDATES = {
    [[__PSM_QUEUE_PATH__]],               -- absolute, rewritten by the app installer
    "../../../Saved/psm-broadcast.jsonl", -- UE4SS 3.x layout (cwd = Win64/ue4ss)
    "../../Saved/psm-broadcast.jsonl",    -- UE4SS 2.x layout (cwd = Win64)
    "./psm-broadcast.jsonl",              -- last resort: next to UE4SS
}

local QUEUE_PATH = nil
local offset = 0 -- bytes of the queue file already consumed

-- Resolve (and cache) the first candidate path we can actually open. Opening for
-- append creates the file if missing, so we can start tailing before the app writes.
local function resolve_path()
    if QUEUE_PATH then return QUEUE_PATH end
    for _, p in ipairs(CANDIDATES) do
        -- Skip the templated placeholder if the installer didn't rewrite it.
        if p:sub(1, 2) ~= "__" then
            local f = io.open(p, "a")
            if f then
                f:close()
                QUEUE_PATH = p
                print(string.format("[PSMBroadcast] watching queue: %s\n", p))
                return QUEUE_PATH
            end
        end
    end
    return nil
end

-- Canonical Lua base64 decoder. The app base64-encodes each message so this is the
-- only transform needed to recover the exact UTF-8 text.
local function b64decode(data)
    local b = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    data = tostring(data):gsub('[^' .. b .. '=]', '')
    return (data:gsub('.', function(x)
        if x == '=' then return '' end
        local r, f = '', (b:find(x) - 1)
        for i = 6, 1, -1 do r = r .. (f % 2 ^ i - f % 2 ^ (i - 1) > 0 and '1' or '0') end
        return r
    end):gsub('%d%d%d?%d?%d?%d?%d?%d?', function(x)
        if #x ~= 8 then return '' end
        local c = 0
        for i = 1, 8 do c = c + (x:sub(i, i) == '1' and 2 ^ (8 - i) or 0) end
        return string.char(c)
    end))
end

-- Resolve the live PalGameStateInGame, the object that carries BroadcastServerNotice.
-- PalUtility (a default/static object) turns the live UWorld into the game state, the
-- same path the community BroadcastServerNotice mod used.
local function get_game_state()
    local util = StaticFindObject("/Script/Pal.Default__PalUtility")
    if not util or not util:IsValid() then return nil, "PalUtility not found" end
    local world = FindFirstOf("World")
    if not world or not world:IsValid() then return nil, "no live world (server booting or empty?)" end
    local ok, gs = pcall(function() return util:GetPalGameStateInGame(world) end)
    if not ok or not gs or not gs:IsValid() then return nil, "no game state" end
    return gs
end

-- Show one message on every player's screen via the server's on-screen notice.
-- Runs on the game thread (see caller). Returns ok, err so failures are logged, not
-- thrown — a signature change in a future Palworld build must never crash the server.
local function announce(text)
    local gs, err = get_game_state()
    if not gs then return false, err end
    return pcall(function() gs:BroadcastServerNotice(text) end)
end

-- Parse one queue line: pull the base64 payload (no quotes inside base64, so the
-- match can't be fooled) and display the decoded text on the game thread.
local function handle_line(line)
    local b64 = line:match('"b64"%s*:%s*"([^"]*)"')
    if not b64 or b64 == "" then return end
    local text = b64decode(b64)
    if not text or text == "" then return end
    ExecuteInGameThread(function()
        local ok, err = announce(text)
        if not ok then
            print("[PSMBroadcast] announce failed: " .. tostring(err) .. "\n")
        end
    end)
end

-- Read any bytes appended since we last looked and handle each complete line.
local function poll()
    local path = resolve_path()
    if not path then return end
    local f = io.open(path, "rb")
    if not f then return end
    local size = f:seek("end") or 0
    if size < offset then offset = 0 end -- file was truncated/rotated
    if size == offset then f:close() return end
    f:seek("set", offset)
    local data = f:read("*a") or ""
    offset = size
    f:close()
    for chunk in data:gmatch("[^\r\n]+") do
        handle_line(chunk)
    end
end

-- On load, jump to the end of the queue so a server restart doesn't replay old
-- broadcasts. New lines the app writes from here on are the only ones we show.
local function seek_to_end()
    local path = resolve_path()
    if not path then return end
    local f = io.open(path, "rb")
    if f then
        offset = f:seek("end") or 0
        f:close()
    end
end

seek_to_end()

-- Poll the queue once a second on UE4SS's async thread; file IO is safe here, and
-- the actual game call is marshalled onto the game thread inside handle_line.
LoopAsync(1000, function()
    local ok, err = pcall(poll)
    if not ok then print("[PSMBroadcast] poll error: " .. tostring(err) .. "\n") end
    return false -- keep looping
end)

print("[PSMBroadcast] loaded — on-screen broadcast ready\n")
