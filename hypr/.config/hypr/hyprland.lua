-- Learn how to configure Hyprland: https://wiki.hypr.land/Configuring/Start/

-- Omarchy's bootstrap keeps path setup out of this user config.
dofile((os.getenv("OMARCHY_PATH") or "/usr/share/omarchy") .. "/default/hypr/bootstrap.lua")

-- Disable all Omarchy default bindings. Add your own in hypr/bindings.lua.
-- omarchy_default_bindings = false
--
-- Or disable only bindings for Omarchy's preinstalled apps/web apps while
-- keeping core window-manager bindings:
-- omarchy_preinstalled_bindings = false

-- Load Omarchy defaults.
require("default.hypr.omarchy")

-- Put your personal overrides in these files. They're loaded after Omarchy's
-- defaults so package updates can improve the defaults without rewriting your
-- ~/.config/hypr files.
-- envs first so env vars (Nvidia, cursor theme) are set before monitors/autostart apps launch
require("hypr.envs")
require("hypr.monitors")
require("hypr.input")
require("hypr.bindings")
require("hypr.looknfeel")
require("hypr.autostart")

-- Toggle config flags dynamically.
require("default.hypr.toggles")

-- Add any other personal Hyprland configuration below.
-- o.window("qemu", { workspace = "5" })

-- The emulator sizes its phone window itself once the device is up, after the
-- open rules, so size it to the monitor's height once that settles.
hl.on("window.title", function(window)
  if window.class ~= "Emulator" or not (window.title or ""):match("^Android Emulator %- ") then
    return
  end

  hl.timer(function()
    local monitor = window.monitor
    if not monitor or not monitor.width then
      return
    end

    local reserved = monitor.reserved or {}
    local usable = math.floor(monitor.height / monitor.scale) - (reserved.top or 0) - (reserved.bottom or 0)
    local height = math.floor(usable * 0.9)

    hl.dispatch(hl.dsp.window.resize({ x = math.floor(height * 1080 / 2400), y = height, relative = false, window = window }))
    hl.dispatch(hl.dsp.window.center({ window = window }))
  end, { timeout = 3000, type = "oneshot" })
end)

hl.layer_rule({
  match = { namespace = "timmo-workspace-relayout" },
  no_anim = true,
  animation = "none",
})
