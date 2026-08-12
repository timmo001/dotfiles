#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
notification_sources=(
  "$repo_root/agents/.config/opencode"
  "$repo_root/hypr"
  "$repo_root/scripts"
  "$repo_root/scripts--laptop"
)

if rg -n -U "omarchy notification send\\s+(?:\\\\\\s*)?[\"']" "${notification_sources[@]}"; then
  printf 'Omarchy notification glyphs must use -g instead of a positional argument.\n' >&2
  exit 1
fi

if rg -n '\bnotify-send\b' "${notification_sources[@]}"; then
  printf 'Desktop notification callers must use omarchy notification send.\n' >&2
  exit 1
fi
