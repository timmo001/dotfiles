#!/bin/bash

# Script to toggle GoXLR fader A mute state between 'muted-to-x' and 'unmuted'

# {"alt":"muted","class":"mic-muted","text":"Muted"}
# {"alt":"unmuted","class":"mic-unmuted","text":"Unmuted"}
# {"alt":"unknown","class":"mic-unknown","text":"Unknown"}
current_state=$(go-monitor | jq -r '.alt')

if [[ "$current_state" == "muted" ]]; then
  # If currently muted, unmute
  goxlr-client faders mute-state a unmuted
else
  # If currently unmuted or unknown, mute
  goxlr-client faders mute-state a muted-to-x
fi
