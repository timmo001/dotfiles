-- Learn how to configure Hyprland: https://wiki.hypr.land/Configuring/Start/

-- Omarchy's bootstrap configures module paths and clears
-- cached user/default modules so `hyprctl reload` reads current files.
dofile((os.getenv("OMARCHY_PATH") or "/usr/share/omarchy") .. "/default/hypr/bootstrap.lua")

-- Omarchy defaults and current theme overrides.
require("default.hypr.omarchy")

-- Local overrides load after Omarchy defaults, allowing package updates to
-- improve defaults without rewriting files under ~/.config/hypr.
-- envs first so env vars (Nvidia, cursor theme) are set before monitors/autostart apps launch
require("hypr.envs")
require("hypr.monitors")
require("hypr.looknfeel")
require("hypr.input")
require("hypr.bindings")
require("hypr.autostart")

-- Dynamic Omarchy toggles.
require("default.hypr.toggles")
