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
  printf '%s\n' '{"result":{"tabs":[{"tab_id":"w36:t1","number":1,"focused":false},{"tab_id":"w36:t2","number":2,"focused":true},{"tab_id":"w36:t3","number":3,"focused":false}]}}'
  exit 0
fi
printf 'herdr %s\n' "$*" >>"$CALLS"
EOF

chmod +x "$mock_bin/hyprctl" "$mock_bin/herdr"

export CALLS="$calls"
export NEW_TERMINAL_TAB_HYPRCTL_BIN="$mock_bin/hyprctl"
export NEW_TERMINAL_TAB_HERDR_BIN="$mock_bin/herdr"

ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"herdr | project"}' "$script" new
grep -Fx 'herdr tab create --focus' "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"herdr | project"}' "$script" close
grep -Fx 'herdr tab close w36:t2' "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"herdr | project"}' "$script" next
grep -Fx 'herdr tab focus w36:t3' "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"herdr | project"}' "$script" previous
grep -Fx 'herdr tab focus w36:t1' "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"shell"}' "$script" new
grep -Fx 'hyprctl dispatch sendshortcut CTRL SHIFT, T, activewindow' "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"shell"}' "$script" close
grep -Fx 'hyprctl dispatch sendshortcut CTRL SHIFT, W, activewindow' "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"shell"}' "$script" next
grep -Fx 'hyprctl dispatch sendshortcut CTRL, TAB, activewindow' "$calls"

: >"$calls"
ACTIVE_WINDOW='{"class":"com.mitchellh.ghostty","title":"shell"}' "$script" previous
grep -Fx 'hyprctl dispatch sendshortcut CTRL SHIFT, TAB, activewindow' "$calls"

printf 'terminal tab action tests passed\n'
