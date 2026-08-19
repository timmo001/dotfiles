-- Wayland
hl.env("ELECTRON_ENABLE_WAYLAND", "1")

-- GPU and VA-API env is host-specific: Nvidia on desktop, Intel iHD on laptop.
-- Set per host in hosts/<host>/envs.lua, loaded via require("hypr.host.envs") below.

-- Cursor
hl.env("HYPRCURSOR_THEME", "catppuccin-mocha-dark-cursors")
hl.env("XCURSOR_SIZE", "20")
hl.env("HYPRCURSOR_SIZE", "20")

-- Released Plannotator versions use the browser hook until external presenter support lands.
hl.env("PLANNOTATOR_BROWSER", "plannotator-browser")

require("hypr.host.envs")
