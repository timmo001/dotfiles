-- See https://wiki.hypr.land/Configuring/Basics/Monitors/
-- List current monitors and supported resolutions with: hyprctl monitors all

-- Configure a specific monitor.
-- hl.monitor({ output = "DP-2", mode = "2560x1440@144", position = "0x0", scale = 1 })

-- Portrait/rotated secondary monitor (transform: 1 = 90°, 3 = 270°).
-- hl.monitor({ output = "DP-2", mode = "preferred", position = "auto", scale = 1, transform = 1 })

require("hypr.host.monitors")

-- The extra screen dot station screen adds, streamed to Station's TV.
hl.monitor({ output = "STATION", mode = "2560x1440@60", position = "auto-left", scale = 4 / 3 })

-- Reapply HDR set by dot hdr on, so a reload doesn't drop it.
local runtime_dir = os.getenv("XDG_RUNTIME_DIR")
local hdr_monitor = runtime_dir and loadfile(runtime_dir .. "/hypr-hdr-monitor.lua")
if hdr_monitor then
  hdr_monitor()
end
