-- Wayland
hl.env("ELECTRON_ENABLE_WAYLAND", "1")

-- Groundwork desktop apps match Chromium's --force-device-scale-factor
hl.env("GROUNDWORK_DESKTOP_ZOOM", "0.8")

-- GPU and VA-API env is host-specific: Nvidia on desktop, Intel iHD on laptop.
-- Set per host in hosts/<host>/envs.lua, loaded via require("hypr.host.envs") below.

-- Cursor
hl.env("HYPRCURSOR_THEME", "catppuccin-mocha-dark-cursors")
hl.env("XCURSOR_SIZE", "20")
hl.env("HYPRCURSOR_SIZE", "20")

require("hypr.host.envs")
