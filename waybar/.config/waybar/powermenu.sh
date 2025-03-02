#!/bin/bash

chosen=$(echo -e " Lock\n⏾ Suspend\n⏻ Power Off\n Reboot\n Logout" | wofi --dmenu --width 300 --height 200 --cache-file /dev/null)

case "$chosen" in
" Lock") swaylock ;;
"⏾ Suspend") systemctl suspend ;;
"⏻ Power Off") systemctl poweroff ;;
" Reboot") systemctl reboot ;;
" Logout") hyprctl dispatch exit ;;
esac
