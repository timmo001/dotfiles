#!/usr/bin/env zsh
# Outputs: HH:MM Sat 10th May

day=$(date +%-d)
suffix="th"
if ((day == 1 || day == 21 || day == 31)); then suffix="st"; fi
if ((day == 2 || day == 22)); then suffix="nd"; fi
if ((day == 3 || day == 23)); then suffix="rd"; fi

printf "%s %s %s%s %s\n" "$(date +%H:%M)" "$(date +%a)" "$day" "$suffix" "$(date +%b)"
