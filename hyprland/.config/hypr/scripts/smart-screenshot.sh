#!/bin/bash

# Smart screenshot with multiple options
choice=$(echo -e "󰹑 Full Screen\n󰩭 Select Area\n󰖟 Active Window\n󰄀 Delayed (5s)\n󰸘 Save to File" | wofi --dmenu --prompt "Screenshot Options" --width 300 --height 250)

case "$choice" in
    "󰹑 Full Screen") 
        grimblast --notify copy screen 
        ;;
    "󰩭 Select Area") 
        grimblast --notify copy area 
        ;;
    "󰖟 Active Window") 
        grimblast --notify copy active 
        ;;
    "󰄀 Delayed (5s)") 
        notify-send "Screenshot" "Taking screenshot in 5 seconds..."
        sleep 5 
        grimblast --notify copy screen 
        ;;
    "󰸘 Save to File")
        mkdir -p ~/Pictures/Screenshots
        filename="screenshot-$(date +%Y%m%d-%H%M%S).png"
        grimblast save screen ~/Pictures/Screenshots/"$filename"
        notify-send "Screenshot" "Saved to ~/Pictures/Screenshots/$filename"
        ;;
esac