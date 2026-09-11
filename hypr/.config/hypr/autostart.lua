-- Extra autostart processes.
-- o.launch_on_start("my-service")

o.exec_on_start("timmo-run-command system-bridge backend")
o.exec_on_start([[uwsm app -- chromium --new-window --ozone-platform=wayland --profile-directory="Default" --force-device-scale-factor=0.8]])
o.exec_on_start("uwsm app -- kdeconnectd")
o.exec_on_start("uwsm-app -s b -- twitch-notifications")
o.exec_on_start("dot herdr start")

require("hypr.host.autostart")
