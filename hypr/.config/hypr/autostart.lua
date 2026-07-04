o.exec_on_start("timmo-run-command system-bridge backend")
o.exec_on_start([[uwsm app -- chromium --new-window --ozone-platform=wayland --profile-directory="Default" --force-device-scale-factor=0.8]])

require("hypr.host.autostart")
