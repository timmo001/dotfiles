-- Extra autostart processes.
-- o.launch_on_start("my-service")

o.exec_on_start("timmo-run-command system-bridge backend")
o.exec_on_start("uwsm app -- kdeconnectd")
o.exec_on_start("dot herdr start")

require("hypr.host.autostart")
