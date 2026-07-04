local machine = require("hypr.lib.machine")

local is_virtual_machine = machine.is_virtual_machine()
local omarchy_gdk_scale = is_virtual_machine and 1 or 2
local omarchy_monitor_scale = is_virtual_machine and 1.0 or 2.0

hl.env("GDK_SCALE", tostring(omarchy_gdk_scale))
hl.env("QT_SCALE_FACTOR", tostring(omarchy_gdk_scale))

hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })
