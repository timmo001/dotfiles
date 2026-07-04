-- Omarchy 4.0 Lua entrypoint.

package.path = os.getenv("HOME")
  .. "/.config/?.lua;"
  .. (os.getenv("OMARCHY_PATH") or (os.getenv("HOME") .. "/.local/share/omarchy"))
  .. "/?.lua;"
  .. package.path

-- Omarchy defaults and current theme overrides.
require("default.hypr.omarchy")
hl.source("~/.config/omarchy/current/theme/hyprland.conf")

-- Local user overrides.
-- envs first so env vars (Nvidia, cursor theme) are set before monitors/autostart apps launch
require("hypr.envs")
require("hypr.monitors")
require("hypr.looknfeel")
require("hypr.input")
require("hypr.bindings")
require("hypr.autostart")

-- Dynamic Omarchy toggles.
require("default.hypr.toggles")
