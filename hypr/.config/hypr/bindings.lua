-- Screen recording
o.bind("SHIFT + ALT + PRINT", "Screenrecording", "omarchy screenrecord")

local terminal = "uwsm app -- ghostty-host-config"
local file_manager = "uwsm app -- thunar"
local browser_personal = [[uwsm app -- chromium --new-window --ozone-platform=wayland --profile-directory="Default" --force-device-scale-factor=0.8]]
local browser_work = "launch-work-browser"
local discord = "launch-work-discord"
local slack = "launch-work-slack"

-- Resume recovery
o.bind("SUPER + SHIFT + W", "Resume recovery", "on-resume --no-auto-open")
-- Let Ghostty confirm the close itself; keep Omarchy's normal close behaviour elsewhere.
hl.unbind("SUPER + W")
o.bind("SUPER + W", "Close window", "close-active-window")

-- Hyprland runs all binds for the same chord in order; unbind clears default bindings first.
hl.unbind("SUPER + TAB")
hl.unbind("CTRL + ALT + TAB")
hl.unbind("CTRL + ALT + SHIFT + TAB")
-- unbind clears tiling-v2 SUPER + ALT + TAB (next window in group).
hl.unbind("SUPER + ALT + TAB")
o.bind("SUPER + TAB", "Workspace relayout", "~/.local/bin/workspace-relayout")
o.bind("SUPER + ALT + TAB", "Workspace relayout edit", "~/.local/bin/workspace-relayout --edit")
o.bind("SUPER + ALT + W", "Workspace menu", "workspace-menu")
o.bind("SUPER + ALT + D", "Dot dashboard", "uwsm app -- xdg-terminal-exec --app-id=TUI.float -e dot dashboard")
o.bind("SUPER + CTRL + P", "Power Profile", "power-profile-menu")
hl.unbind("SUPER + SHIFT + F")
o.bind("SUPER + SHIFT + F", "Add floating application", "/usr/bin/float-app add")

-- Terminal
o.bind("SUPER + RETURN", "Terminal", terminal .. " --working-directory=$(omarchy-cmd-terminal-cwd)")
o.bind("SUPER + SHIFT + RETURN", "Floating Terminal", "uwsm app -- xdg-terminal-exec --app-id=org.omarchy.terminal")
o.bind("SUPER + Q", "Herdr", terminal .. " -e herdr session attach default")
o.bind("SUPER + SHIFT + Q", "Floating Herdr", "uwsm app -- xdg-terminal-exec --app-id=org.omarchy.terminal -e herdr session attach default")
o.bind("SUPER + ALT + RETURN", "Tmux", [[uwsm-app -- xdg-terminal-exec --dir="$(omarchy-cmd-terminal-cwd)" tmux new]])
hl.unbind("CTRL + SHIFT + T")
o.bind("CTRL + SHIFT + T", "New terminal tab", "terminal-tab-action new")
hl.unbind("CTRL + SHIFT + W")
o.bind("CTRL + SHIFT + W", "Close terminal tab", "terminal-tab-action close")
hl.unbind("CTRL + TAB")
o.bind("CTRL + TAB", "Next terminal tab", "terminal-tab-action next")
hl.unbind("CTRL + SHIFT + TAB")
o.bind("CTRL + SHIFT + TAB", "Previous terminal tab", "terminal-tab-action previous")
o.bind("SUPER + SHIFT + T", "New Ghostty tab", "terminal-tab-action ghostty-new")

-- File manager
o.bind("SUPER + E", "File manager", file_manager)

-- Browser
o.bind("SUPER + B", "Browser", browser_personal)
o.bind("SUPER + SHIFT + B", "Browser (private)", browser_personal .. " --private")
o.bind("SUPER + ALT + B", "Browser Work", browser_work)

-- Chat and apps
o.bind("SUPER + SHIFT + S", "Slack", slack)
o.bind("SUPER + M", "Music Assistant", [[omarchy-launch-webapp "http://homeassistant.local:8095"]])
o.bind("SUPER + ALT + N", "Notes", "uwsm app -- xdg-terminal-exec --app-id=TUI.float -e notes --all")
o.bind("SUPER + SHIFT + SLASH", "Passwords", "uwsm app -- 1password")
o.bind("SUPER + Y", "YouTube", [[omarchy-launch-webapp "https://www.youtube.com/feed/subscriptions"]])
o.bind("SUPER + X", "X", [[omarchy-launch-webapp "https://twitter.com/notifications"]])
o.bind("SUPER + SHIFT + X", "X Post", [[omarchy-launch-webapp "https://x.com/compose/post"]])
o.bind("SUPER + ALT + T", "Twitch", [[omarchy-launch-webapp "https://twitch.tv/directory/following/live"]])
o.bind("SUPER + ALT + G", "GitHub Notifications", [[omarchy-launch-webapp "https://github.com/notifications"]])
o.bind("SUPER + D", "Discord", discord)

-- Home Assistant
o.bind("SUPER + H", "Home Assistant", [[omarchy-launch-webapp "http://homeassistant.local:8123"]])
o.bind("SUPER + ALT + H", "Handoffs", "uwsm app -- xdg-terminal-exec --app-id=TUI.float -e notes handoffs --all")
o.bind("SUPER + A", "Home Assistant Assist", [[omarchy-launch-webapp "http://homeassistant.local:8123/?conversation=1"]])

-- Local automations
o.bind("SUPER + SHIFT + C", nil, "timmo-run-command go-automate ha ib t in_a_call")
o.bind("SUPER + SHIFT + M", nil, "pactl set-source-mute @DEFAULT_SOURCE@ toggle")
o.bind("CTRL + ALT + T", nil, "~/.local/bin/twitch-menu")
o.bind("CTRL + ALT + SHIFT + T", nil, "~/.local/bin/twitch-menu channels")
o.bind("CTRL + ALT + R", nil, "uwsm app -- xdg-terminal-exec --app-id=TUI.float -e dot tui git-diff")
o.bind("CTRL + ALT + SHIFT + R", nil, "uwsm app -- xdg-terminal-exec --app-id=TUI.float -e dot tui git-diff --tab other")

-- Overrides Omarchy's default SUPER+CTRL+ALT+T single local time notification.
hl.unbind("SUPER + CTRL + ALT + T")
o.bind("SUPER + CTRL + ALT + T", "Show times", [[omarchy notification send "" "Times" "$(~/.local/bin/times --notify)" -u low]])

-- Precise window resizing (fractional, like 1% volume with ALT)
o.bind("SUPER + ALT + code:20", "Shrink window width (precise)", hl.dsp.window.resize({ x = -2, y = 0, relative = true }))
o.bind("SUPER + ALT + code:21", "Expand window width (precise)", hl.dsp.window.resize({ x = 2, y = 0, relative = true }))
o.bind("SUPER + ALT + SHIFT + code:20", "Shrink window height (precise)", hl.dsp.window.resize({ x = 0, y = -2, relative = true }))
o.bind("SUPER + ALT + SHIFT + code:21", "Expand window height (precise)", hl.dsp.window.resize({ x = 0, y = 2, relative = true }))

require("hypr.host.bindings")
