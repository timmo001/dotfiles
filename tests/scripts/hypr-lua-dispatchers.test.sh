#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

legacy_dispatchers='dispatch[[:space:]]+(closewindow|exec|focuswindow|layoutmsg|moveactive|movetoworkspace|movetoworkspacesilent|resizeactive|resizewindowpixel|setfloating|tagwindow|workspace)([[:space:]]|$)'

if rg -n "$legacy_dispatchers" \
  "$repo_root/scripts/.local/bin" \
  "$repo_root/agents/.config/opencode"; then
  printf 'Found legacy Hyprland dispatcher syntax; use hl.dsp Lua dispatchers.\n' >&2
  exit 1
fi
