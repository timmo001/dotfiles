#!/usr/bin/env bash
set -euo pipefail

if [[ "${TWITCH_NOTIFICATIONS_RESTART_DETACHED:-0}" != "1" ]]; then
  export TWITCH_NOTIFICATIONS_RESTART_DETACHED=1
  setsid "$0" "$@" >/dev/null 2>&1 &
  exit 0
fi

pkill -f '/usr/bin/twitch-notifications( |$)' >/dev/null 2>&1 || pkill -f '(^| )twitch-notifications( |$)' >/dev/null 2>&1 || true
sleep 1
exec uwsm-app -- twitch-notifications >/dev/null 2>&1
