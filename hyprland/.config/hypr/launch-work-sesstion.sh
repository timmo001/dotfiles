#!/usr/bin/env zsh

goxlr-daemon &
cd ~/Applications/Postman\ Agent && ./Postman\ Agent &

# Add a delay for monitors to be set up
sleep 8

# Left monitor
slack &
flatpak run app.zen_browser.zen &

# Right monitor
ghostty &
google-chrome --profile-directory="Profile 1" &


