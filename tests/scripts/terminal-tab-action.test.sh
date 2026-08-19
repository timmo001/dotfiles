#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo_root/scripts/.local/bin/terminal-tab-action"
test_dir=$(mktemp -d)
mock_bin="$test_dir/bin"
calls="$test_dir/calls"

trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$mock_bin"

cat >"$mock_bin/hyprctl" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "activewindow" ]]; then
  printf '%s\n' "$ACTIVE_WINDOW"
  exit 0
fi
printf 'hyprctl %s\n' "$*" >>"$CALLS"
EOF

cat >"$mock_bin/herdr" <<'EOF'
#!/usr/bin/env bash
if [[ "$1 $2" == "tab list" ]]; then
  if [[ -n "${HERDR_TABS:-}" ]]; then
    printf '%s\n' "$HERDR_TABS"
  else
    printf '%s\n' '{"result":{"tabs":[{"tab_id":"w36:t1","number":1,"focused":false},{"tab_id":"w36:t2","number":2,"focused":true},{"tab_id":"w36:t3","number":3,"focused":false}]}}'
  fi
  exit 0
fi
printf 'herdr %s\n' "$*" >>"$CALLS"
EOF

chmod +x "$mock_bin/hyprctl" "$mock_bin/herdr"

export CALLS="$calls"
export NEW_TERMINAL_TAB_HYPRCTL_BIN="$mock_bin/hyprctl"
export NEW_TERMINAL_TAB_HERDR_BIN="$mock_bin/herdr"

ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"herdr"}' "$script" new
grep -Fx 'herdr tab create --focus' "$calls"

: >"$calls"
ACTIVE_WINDOW='{"address":"abc123","class":"com.mitchellh.ghostty","title":"herdr"}' "$script" ghostty-new
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL ALT SHIFT', key = 'N', state = 'down' })" "$calls"
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL ALT SHIFT', key = 'N', state = 'up' })" "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"herdr"}' "$script" close
grep -Fx 'herdr tab close w36:t2' "$calls"
if grep -Fq 'herdr session stop' "$calls"; then
  printf 'session stopped while closing a tab\n' >&2
  exit 1
fi

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"herdr"}' "$script" next
grep -Fx 'herdr tab focus w36:t3' "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"herdr"}' "$script" previous
grep -Fx 'herdr tab focus w36:t1' "$calls"

: >"$calls"
HERDR_TABS='{"result":{"tabs":[{"tab_id":"w36:t1","number":1,"focused":true}]}}' \
  ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"herdr"}' "$script" close
grep -Fx 'herdr tab close w36:t1' "$calls"
if grep -Fq 'herdr session stop' "$calls"; then
  printf 'session stopped while closing the final tab\n' >&2
  exit 1
fi

: >"$calls"
ACTIVE_WINDOW='{"address":"abc123","class":"com.mitchellh.ghostty","title":"shell"}' "$script" new
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL ALT SHIFT', key = 'N', state = 'down' })" "$calls"
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL ALT SHIFT', key = 'N', state = 'up' })" "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"shell"}' "$script" close
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL SHIFT', key = 'W', state = 'down' })" "$calls"
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL SHIFT', key = 'W', state = 'up' })" "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"shell"}' "$script" next
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL', key = 'TAB', state = 'down' })" "$calls"
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL', key = 'TAB', state = 'up' })" "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"shell"}' "$script" previous
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL SHIFT', key = 'TAB', state = 'down' })" "$calls"
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL SHIFT', key = 'TAB', state = 'up' })" "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"chromium","title":"Browser"}' "$script" new
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL SHIFT', key = 'T', state = 'down' })" "$calls"
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL SHIFT', key = 'T', state = 'up' })" "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"chromium","title":"Browser"}' "$script" next
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL', key = 'TAB', state = 'down' })" "$calls"
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL', key = 'TAB', state = 'up' })" "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"chromium","title":"Browser"}' "$script" previous
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL SHIFT', key = 'TAB', state = 'down' })" "$calls"
grep -Fq "hl.dsp.send_key_state({ mods = 'CTRL SHIFT', key = 'TAB', state = 'up' })" "$calls"

printf 'terminal tab action tests passed\n'
