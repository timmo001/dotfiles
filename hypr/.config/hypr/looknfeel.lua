-- Change the default Omarchy look'n'feel.

-- https://wiki.hypr.land/Configuring/Basics/Variables/#general
-- hl.config({
--   general = {
--     -- No gaps between windows or borders.
--     gaps_in = 0,
--     gaps_out = 0,
--     border_size = 0,
--
--     -- Change to niri-like side-scrolling layout.
--     layout = "scrolling",
--   },
-- })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#decoration
-- hl.config({
--   decoration = {
--     -- Use round window corners.
--     rounding = 8,
--
--     -- Dim unfocused windows (0.0 = no dim, 1.0 = fully dimmed).
--     dim_inactive = true,
--     dim_strength = 0.15,
--   },
-- })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#animations
-- hl.config({
--   animations = {
--     -- Disable all animations.
--     enabled = false,
--   },
-- })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#layout
-- hl.config({
--   layout = {
--     -- Avoid overly wide single-window layouts on wide screens.
--     single_window_aspect_ratio = { 1, 1 },
--   },
-- })

-- https://wiki.hypr.land/Configuring/Layouts/Scrolling-Layout/
-- hl.config({
--   scrolling = {
--     -- See only one column per screen instead of two.
--     column_width = 0.97,
--   },
-- })

hl.config({
  general = {
    gaps_out = 0,
    border_size = 1,
    col = {
      inactive_border = "rgba(595959aa)",
    },
    resize_on_border = true,
    allow_tearing = false,
    layout = "dwindle",
  },
})

-- Smart gaps
hl.workspace_rule({ workspace = "w[tv1]", gaps_out = 0, gaps_in = 0 })
hl.workspace_rule({ workspace = "f[1]", gaps_out = 0, gaps_in = 0 })
hl.window_rule({ name = "smart-gaps-wtv1", match = { float = false, workspace = "w[tv1]" }, border_size = 0, rounding = 0 })
hl.window_rule({ name = "smart-gaps-f1", match = { float = false, workspace = "f[1]" }, border_size = 0, rounding = 0 })

-- Chrome opacity override.
hl.window_rule({ name = "tag-chromium-based-browser", match = { class = "(google-)?[cC]hrom(e|ium)(-stable|-unstable)?|[bB]rave-browser|Microsoft-edge|Vivaldi-stable" }, tag = "+chromium-based-browser" })
hl.window_rule({ name = "opaque-chromium-based-browser", match = { tag = "chromium-based-browser" }, opacity = "1 1" })

-- Video websites and Home Assistant should be opaque.
hl.window_rule({ name = "opaque-twitch", match = { initial_title = ".*twitch\\.tv.*" }, opacity = "1 1" })
hl.window_rule({ name = "opaque-youtube", match = { initial_title = ".*youtube\\.com.*" }, opacity = "1 1" })
hl.window_rule({ name = "opaque-corridor", match = { initial_title = ".*corridordigital\\.com.*" }, opacity = "1 1" })
hl.window_rule({ name = "opaque-floatplane", match = { initial_title = ".*floatplane\\.com.*" }, opacity = "1 1" })
hl.window_rule({ name = "opaque-vivaplus", match = { initial_title = ".*vivaplus\\.tv.*" }, opacity = "1 1" })
hl.window_rule({ name = "opaque-home-assistant", match = { title = ".*Home Assistant.*" }, opacity = "1 1" })
hl.window_rule({ name = "opaque-virt-manager", match = { class = "^virt-manager$" }, opacity = "1 1" })

-- Shared workspace rules.
hl.window_rule({ name = "workspace-slicers", match = { class = "^(BambuStudio|OrcaSlicer)$" }, workspace = "4" })
hl.window_rule({ name = "workspace-plannotator", match = { class = "^plannotator$" }, workspace = "2 silent" })

require("hypr.host.looknfeel")

-- float-app rules: start
require("float-app")
-- float-app rules: end
