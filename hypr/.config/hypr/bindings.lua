-- Keep only your personal keybinding overrides here. Add new bindings or
-- unbind defaults before replacing them.

-- See current bindings and descriptions:
--   omarchy menu keybindings --print

-- To disable every Omarchy default binding, set this in
-- ~/.config/hypr/hyprland.lua before require("default.hypr.omarchy"), then add
-- only the bindings you want below:
--   omarchy_default_bindings = false

-- To disable all preinstalled app/webapp bindings, set:
--   omarchy_preinstalled_bindings = false

-- Add a new binding.
-- o.bind("SUPER + SHIFT + R", "SSH", "alacritty -e ssh your-server")

-- Change an existing binding by unbinding it first, then binding the key again.
-- This example changes SUPER+SPACE from the launcher to the Omarchy root menu.
-- hl.unbind("SUPER + SPACE")
-- o.bind("SUPER + SPACE", "Omarchy menu", "omarchy-menu toggle root")

-- Disable a default binding without replacing it.
-- hl.unbind("SUPER + SHIFT + B")

-- Logitech MX Keys examples:
-- o.bind("SUPER + SHIFT + S", nil, "omarchy-capture-screenshot")
-- o.bind("SUPER + H", nil, "voxtype record toggle")
-- o.bind("SUPER + PERIOD", nil, "omarchy-shell shell toggle omarchy.emojis")

-- Screen recording
o.bind("SHIFT + ALT + PRINT", "Screenrecording", "omarchy screenrecord")

-- Hex dictation on its default Alt+Space, and on F9 instead of Omarchy's
-- push-to-talk. Hyprland gives Hex's portal shortcuts no key, so bind them
-- here; Hex handles hold and double-tap.
hl.unbind("F9")
o.bind("ALT + SPACE", "Hex dictation", hl.dsp.global("hex:dictation"))
o.bind("F9", "Hex dictation", hl.dsp.global("hex:dictation"))

local terminal = "uwsm app -- ghostty-host-config"
local file_manager = "uwsm app -- thunar"
local browser_personal =
  [[uwsm app -- chromium --new-window --ozone-platform=wayland --profile-directory="Default" --force-device-scale-factor=0.8]]
local browser_work = "launch-work-browser"
local discord =
  [[uwsm app -- google-chrome-stable --new-window --ozone-platform=wayland --force-device-scale-factor=0.8 --profile-directory="Profile 1" --user-data-dir="$HOME/.config/google-chrome-work" --class=work-browser --app=https://discord.com/app]]
local slack =
  [[uwsm app -- google-chrome-stable --new-window --ozone-platform=wayland --force-device-scale-factor=0.8 --profile-directory="Profile 1" --user-data-dir="$HOME/.config/google-chrome-work" --class=work-browser --app=https://app.slack.com/client]]

-- Resume recovery
o.bind("SUPER + SHIFT + R", "Reload UI", "dot reload --no-auto-open")

-- Hyprland runs all binds for the same chord in order; unbind clears default bindings first.
hl.unbind("SUPER + TAB")
hl.unbind("CTRL + ALT + TAB")
hl.unbind("CTRL + ALT + SHIFT + TAB")
-- unbind clears tiling-v2 SUPER + ALT + TAB (next window in group).
hl.unbind("SUPER + ALT + TAB")
-- Unbind SUPER+CTRL+TAB (was: former workspace).
hl.unbind("SUPER + CTRL + TAB")
o.bind("SUPER + TAB", "Workspace relayout", "dot workspace relayout")
o.bind("SUPER + ALT + TAB", "Workspace relayout edit", "dot workspace relayout --edit")
o.bind("SUPER + CTRL + TAB", "Workspace setup", "workspace-menu")
o.bind("SUPER + CTRL + ALT + P", "Power Profile", "power-profile-menu")
-- Delayed so releasing the chord doesn't wake the screen; any key or mouse move wakes it.
o.bind("SUPER + CTRL + ALT + O", "Screen off", function()
  hl.timer(function()
    hl.dispatch(hl.dsp.dpms({ action = "disable" }))
  end, { timeout = 500, type = "oneshot" })
end)
o.bind(
  "SUPER + CTRL + ALT + U",
  "Update",
  [[dot herdr repo open dotfiles "${DOTFILES_PUBLIC_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/dotfiles}" Update "dot up"]]
)
hl.unbind("SUPER + SHIFT + F")
o.bind("SUPER + SHIFT + F", "Add floating application", "/usr/bin/float-app add")

-- Workspaces numbered across all monitors, as before Omarchy gave each monitor
-- its own 1-10 (omacom/omarchy#15655). The no-op reconcile stops Omarchy
-- renumbering workspaces into per-monitor blocks on reloads and hotplugs.
-- The plain focus keeps omarchy-hyprland-window-close-all on workspace 1.
o.workspaces.reconcile = function() end
o.workspaces.focus = function(slot)
  return hl.dsp.focus({ workspace = tostring(slot) })
end
for workspace = 1, 10 do
  local key = "code:" .. tostring(workspace + 9)
  local id = tostring(workspace)
  hl.unbind("SUPER + " .. key)
  hl.unbind("SUPER + SHIFT + " .. key)
  hl.unbind("SUPER + SHIFT + ALT + " .. key)
  o.bind("SUPER + " .. key, "Switch to workspace " .. workspace, hl.dsp.focus({ workspace = id }))
  o.bind("SUPER + SHIFT + " .. key, "Move window to workspace " .. workspace, hl.dsp.window.move({ workspace = id }))
  o.bind(
    "SUPER + SHIFT + ALT + " .. key,
    "Move window silently to workspace " .. workspace,
    hl.dsp.window.move({ workspace = id, follow = false })
  )
end
hl.unbind("SUPER + SHIFT + TAB")
o.bind("SUPER + SHIFT + TAB", "Previous workspace", hl.dsp.focus({ workspace = "e-1" }))
hl.unbind("SUPER + mouse_down")
hl.unbind("SUPER + mouse_up")
o.bind("SUPER + mouse_down", "Scroll active workspace forward", hl.dsp.focus({ workspace = "e+1" }))
o.bind("SUPER + mouse_up", "Scroll active workspace backward", hl.dsp.focus({ workspace = "e-1" }))
for _, move in ipairs({ { "LEFT", "l" }, { "RIGHT", "r" }, { "UP", "u" }, { "DOWN", "d" } }) do
  hl.unbind("SUPER + SHIFT + ALT + " .. move[1])
  o.bind(
    "SUPER + SHIFT + ALT + " .. move[1],
    "Move workspace to " .. move[1]:lower() .. " monitor",
    hl.dsp.workspace.move({ monitor = move[2] })
  )
end

-- Terminal
hl.unbind("SUPER + RETURN")
o.bind("SUPER + RETURN", "Terminal", terminal .. " --working-directory=$(omarchy-cmd-terminal-cwd)")
hl.unbind("SUPER + Q")
o.bind("SUPER + Q", "Herdr", terminal .. " -e herdr session attach default")
o.bind(
  "SUPER + SHIFT + Q",
  "Floating Herdr",
  "uwsm app -- xdg-terminal-exec --app-id=org.omarchy.terminal -e herdr session attach default"
)
hl.unbind("CTRL + SHIFT + T")
o.bind("CTRL + SHIFT + T", "New terminal tab", "terminal-tab-action new")
hl.unbind("CTRL + SHIFT + W")
o.bind("CTRL + SHIFT + W", "Close terminal tab", "terminal-tab-action close")
hl.unbind("CTRL + TAB")
hl.unbind("CTRL + SHIFT + TAB")
o.bind("CTRL + TAB", "Next terminal tab", "terminal-tab-action next")
o.bind("CTRL + SHIFT + TAB", "Previous terminal tab", "terminal-tab-action previous")
o.bind("SUPER + SHIFT + T", "New Ghostty tab", "terminal-tab-action ghostty-new")

-- File manager
o.bind("SUPER + E", "File manager", file_manager)

-- Browser
o.bind("SUPER + B", "Browser", browser_personal)
hl.unbind("SUPER + SHIFT + B")
o.bind("SUPER + SHIFT + B", "Browser (private)", browser_personal .. " --private")
o.bind("SUPER + ALT + B", "Browser Work", browser_work)

-- Chat and apps
hl.unbind("SUPER + SHIFT + G") -- Signal
hl.unbind("SUPER + SHIFT + A") -- ChatGPT
hl.unbind("SUPER + SHIFT + ALT + A") -- Grok
hl.unbind("SUPER + SHIFT + C") -- HEY Calendar
hl.unbind("SUPER + SHIFT + E") -- HEY Email
hl.unbind("SUPER + SHIFT + ALT + E") -- HEY New email
hl.unbind("SUPER + SHIFT + CTRL + G") -- Google Messages
hl.unbind("SUPER + SHIFT + P") -- Google Photos
hl.unbind("SUPER + SHIFT + S") -- Google Maps
o.bind("SUPER + CTRL + SHIFT + S", "Slack", slack)
o.bind("SUPER + ALT + N", "Notes", "uwsm app -- xdg-terminal-exec --app-id=TUI.float -e notes --all")
o.bind("SUPER + Y", "YouTube", [[omarchy-launch-webapp "https://www.youtube.com/feed/subscriptions"]])
o.bind("SUPER + ALT + X", "X Notifications", [[omarchy-launch-webapp "https://twitter.com/notifications"]])
o.bind("SUPER + ALT + T", "Twitch", [[omarchy-launch-webapp "https://twitch.tv/directory/following/live"]])
hl.unbind("SUPER + ALT + G")
o.bind("SUPER + CTRL + SHIFT + G", "Move active window out of group", hl.dsp.window.move({ out_of_group = true }))
o.bind("SUPER + ALT + G", "GitHub Notifications", [[omarchy-launch-webapp "https://github.com/notifications"]])
o.bind("SUPER + D", "Discord", discord)

-- Home Assistant
o.bind("SUPER + H", "Home Assistant", [[omarchy-launch-webapp "https://prod.ha-core.localhost"]])
o.bind("SUPER + ALT + H", "Handoffs", "uwsm app -- xdg-terminal-exec --app-id=TUI.float -e notes handoffs --all")
o.bind("CTRL + ALT + H", "Home Assistant panel", "omarchy-shell shell toggle timmo.home-assistant")
o.bind("CTRL + ALT + G", "Git panel", "omarchy-shell shell toggle timmo.git")
o.bind("CTRL + ALT + SHIFT + G", "Other repositories", "omarchy-shell timmo.git other")
o.bind("CTRL + ALT + S", "System Bridge panel", "omarchy-shell shell toggle timmo.system-bridge")
o.bind("CTRL + ALT + N", "Notes panel", "omarchy-shell shell toggle timmo.notes")
o.bind("CTRL + ALT + U", "Services panel", "omarchy-shell shell toggle timmo.services")
o.bind("CTRL + ALT + SHIFT + S", "Services panel", "omarchy-shell shell toggle timmo.services")
o.bind("CTRL + ALT + C", "Capture note", "omarchy-shell timmo.notes capture")
o.bind("CTRL + ALT + M", "MOMENTUM 4 controls", "omarchy-shell shell toggle timmo.momentumctl")
o.bind("CTRL + ALT + T", "Up Next: Twitch", "omarchy-shell timmo.upnext twitch")
o.bind("CTRL + ALT + Y", "Up Next: YouTube", "omarchy-shell timmo.upnext youtube")
o.bind("CTRL + ALT + F", "Agent Checks: CI", [[omarchy-shell timmo.agent-checks ci "" ""]])
o.bind("CTRL + ALT + L", "Agent Checks: lint", [[omarchy-shell timmo.agent-checks lint "" ""]])
o.bind("CTRL + ALT + PERIOD", "Devices panel", "omarchy-shell shell toggle sceny.devices")
o.bind("CTRL + ALT + I", "Plannotator Inbox panel", "omarchy-shell timmo.plannotator-inbox toggle")

-- Local automations
o.bind("SUPER + CTRL + SHIFT + C", nil, "timmo-run-command ha-bridge input_boolean toggle input_boolean.in_a_call")
o.bind("SUPER + CTRL + SHIFT + M", nil, "pactl set-source-mute @DEFAULT_SOURCE@ toggle")
-- Opens the clock panel with local and US time zones.
hl.unbind("SUPER + CTRL + T")
o.bind("SUPER + CTRL + T", "Clock", "omarchy-shell shell toggle timmo.clock")

-- No scratchpad
hl.unbind("SUPER + S")
hl.unbind("SUPER + ALT + S")
hl.unbind("SUPER + CTRL + S")
o.bind("SUPER + S", "Share", "omarchy-menu toggle share")

-- Precise window resizing (fractional, like 1% volume with ALT)
hl.unbind("SUPER + ALT + code:20")
hl.unbind("SUPER + ALT + code:21")
hl.unbind("SUPER + SHIFT + ALT + code:20")
hl.unbind("SUPER + SHIFT + ALT + code:21")
o.bind(
  "SUPER + ALT + code:20",
  "Shrink window width (precise)",
  hl.dsp.window.resize({ x = -2, y = 0, relative = true })
)
o.bind(
  "SUPER + ALT + code:21",
  "Expand window width (precise)",
  hl.dsp.window.resize({ x = 2, y = 0, relative = true })
)
o.bind(
  "SUPER + ALT + SHIFT + code:20",
  "Shrink window height (precise)",
  hl.dsp.window.resize({ x = 0, y = -2, relative = true })
)
o.bind(
  "SUPER + ALT + SHIFT + code:21",
  "Expand window height (precise)",
  hl.dsp.window.resize({ x = 0, y = 2, relative = true })
)

require("hypr.host.bindings")
