-- May want to use 1.666667 (both)
local omarchy_gdk_scale = 1.6
local omarchy_monitor_scale = 1.6

hl.env("GDK_SCALE", tostring(omarchy_gdk_scale))
hl.env("QT_SCALE_FACTOR", tostring(omarchy_gdk_scale))

hl.monitor({ output = "DP-1", mode = "3840x2160@143.86Hz", position = "-1350x0", scale = omarchy_monitor_scale, transform = 1 })
hl.monitor({ output = "HDMI-A-2", mode = "3840x2160@240.00Hz", position = "0x504", scale = omarchy_monitor_scale })
hl.monitor({ output = "Virtual-1", mode = "3840x2160@60", position = "0x0", scale = omarchy_monitor_scale })
hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })

hl.workspace_rule({ workspace = "1", default_name = "Main Left", monitor = "DP-1", default = true })
hl.workspace_rule({ workspace = "2", default_name = "Main Right A", monitor = "HDMI-A-2", default = true })
hl.workspace_rule({ workspace = "3", default_name = "Main Right B", monitor = "HDMI-A-2" })
hl.workspace_rule({ workspace = "4", default_name = "Main Right C", monitor = "HDMI-A-2" })
hl.workspace_rule({ workspace = "5", default_name = "Main Right D", monitor = "HDMI-A-2" })
hl.workspace_rule({ workspace = "6", default_name = "Main Right E", monitor = "HDMI-A-2" })
