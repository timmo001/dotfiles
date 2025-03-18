#!/bin/bash

chosen=$(echo -e " Lock\n⏾ Suspend\n⏻ Power Off\n Reboot\n Reboot to windows\n Logout" | wofi --dmenu --width 320 --height 360 --cache-file /dev/null)

case "$chosen" in
" Lock") pidof hyprlock || hyprlock ;;
"⏾ Suspend") systemctl suspend ;;
"⏻ Power Off") systemctl poweroff ;;
" Reboot") systemctl reboot ;;
" Reboot to windows") sh /home/aidan/.config/waybar/reboot-to-windows.sh ;;
" Logout") hyprctl dispatch exit ;;
esac
