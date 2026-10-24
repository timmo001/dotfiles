-- See https://wiki.hypr.land/Configuring/Basics/Monitors/
-- List current monitors and supported resolutions with: hyprctl monitors all

-- Configure a specific monitor.
-- hl.monitor({ output = "DP-2", mode = "2560x1440@144", position = "0x0", scale = 1 })

-- Portrait/rotated secondary monitor (transform: 1 = 90°, 3 = 270°).
-- hl.monitor({ output = "DP-2", mode = "preferred", position = "auto", scale = 1, transform = 1 })

require("hypr.host.monitors")

-- Reapply HDR set by toggle-primary-monitor-hdr, so a reload doesn't drop it.
local runtime_dir = os.getenv("XDG_RUNTIME_DIR")
local hdr_monitor = runtime_dir and loadfile(runtime_dir .. "/hypr-hdr-monitor.lua")
if hdr_monitor then
  hdr_monitor()
end
