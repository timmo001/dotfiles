#!/bin/bash

# Quick workspace navigation with descriptions
workspaces="1 󰙯 Communication
2 󰨞 Development  
3 󰈹 Browser
4  Terminal
5 󰊴 Gaming
6 󰎆 Media
7 󰈙 Files
8 󰍉 System
9 󰌢 Overflow
10 󰐃 Scratch"

selected=$(echo "$workspaces" | wofi --dmenu --prompt "Go to Workspace" --width 400 --height 400)

if [ -n "$selected" ]; then
    workspace_num=$(echo "$selected" | cut -d' ' -f1)
    hyprctl dispatch workspace "$workspace_num"
fi