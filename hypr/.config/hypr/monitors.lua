-- See https://wiki.hypr.land/Configuring/Basics/Monitors/
-- List current monitors and supported resolutions with: hyprctl monitors all

-- Configure a specific monitor.
-- hl.monitor({ output = "DP-2", mode = "2560x1440@144", position = "0x0", scale = 1 })

-- Portrait/rotated secondary monitor (transform: 1 = 90°, 3 = 270°).
-- hl.monitor({ output = "DP-2", mode = "preferred", position = "auto", scale = 1, transform = 1 })

require("hypr.host.monitors")

-- The extra desktop dot station desktop adds, streamed to Station's TV.
hl.monitor({ output = "STATION", mode = "2560x1440@60", position = "auto-left", scale = 4 / 3 })

-- The off-screen desktops dot agent screen adds, where agents run browser
-- windows without them showing on a real monitor. AGENT holds new agent
-- windows; dot agent screen claim moves each session's window to a desk of its
-- own (AGENT-1 and up). Each shows one workspace, since a headless output only
-- draws its active one. They sit far from the real monitors, so the cursor
-- can't wander onto them.
local agent_desks = 6
for desk = 0, agent_desks do
  local output = desk == 0 and "AGENT" or ("AGENT-" .. desk)
  local workspace = desk == 0 and "agent" or ("agent-" .. desk)
  hl.monitor({ output = output, mode = "2560x1440@60", position = (-10000 - desk * 3000) .. "x-10000", scale = 1.6 })
  hl.workspace_rule({ workspace = "name:" .. workspace, monitor = output, default = true })
end

-- browse opens every agent window as about:blank, and Hyprland would focus it
-- on the user's workspace. Hold it on AGENT instead, without focus. Page
-- popups that start blank go there too.
hl.window_rule({
  name = "agent-browser-windows",
  match = { class = "^(chromium)$", initial_title = "^about:blank - Chromium$" },
  workspace = "name:agent silent",
  no_initial_focus = true,
})

-- Reapply HDR set by dot hdr on, so a reload doesn't drop it.
local runtime_dir = os.getenv("XDG_RUNTIME_DIR")
local hdr_monitor = runtime_dir and loadfile(runtime_dir .. "/hypr-hdr-monitor.lua")
if hdr_monitor then
  hdr_monitor()
end
