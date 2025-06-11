#!/bin/bash

# Check if it's morning (between 8am and 11am) and a weekday
if [ $(date +%H) -ge 8 ] && [ $(date +%H) -lt 11 ] && [ $(date +%u) -lt 6 ]; then
  # Launch work setup
  slack &
  google-chrome-stable --enable-features=UseOzonePlatform --ozone-platform=wayland --ozone-platform-hint=auto --profile-directory="Profile 1" &
fi
