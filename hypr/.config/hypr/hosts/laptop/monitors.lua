local omarchy_gdk_scale = 2
local omarchy_monitor_scale = 2.0

hl.env("GDK_SCALE", tostring(omarchy_gdk_scale))
hl.env("QT_SCALE_FACTOR", tostring(omarchy_gdk_scale))

hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })
hl.monitor({ output = "Virtual-1", mode = "3840x2160@60", position = "0x0", scale = omarchy_monitor_scale })
