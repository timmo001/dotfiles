o.exec_on_start("timmo-run-command system-bridge backend")
o.exec_on_start([[uwsm app -- chromium --new-window --ozone-platform=wayland --profile-directory="Default" --force-device-scale-factor=0.8]])
o.exec_on_start("uwsm app -- kdeconnect-indicator")
o.exec_on_start("uwsm-app -s b -- twitch-notifications")
o.exec_on_start("uwsm-app -s b -- env USAGEBAR_DISABLE_BROWSER_COOKIES=1 herdr server")

require("hypr.host.autostart")
