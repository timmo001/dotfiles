#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
reload_ui="$repo_root/scripts/.local/bin/reload-ui"
test_root=$(mktemp -d)
mock_bin="$test_root/bin"
calls="$test_root/calls"
mkdir -p "$mock_bin"
trap 'rm -rf "$test_root"' EXIT

cat >"$mock_bin/dot" <<'EOF'
#!/bin/bash
printf 'dot %s\n' "$*" >>"$RELOAD_UI_TEST_CALLS"
EOF

cat >"$mock_bin/omarchy" <<'EOF'
#!/bin/bash
printf 'omarchy %s\n' "$*" >>"$RELOAD_UI_TEST_CALLS"
EOF

cat >"$mock_bin/omarchy-shell" <<'EOF'
#!/bin/bash
printf 'omarchy-shell %s\n' "$*" >>"$RELOAD_UI_TEST_CALLS"
EOF

cat >"$mock_bin/twitch-notifications" <<'EOF'
#!/bin/bash
exit 0
EOF

chmod +x "$mock_bin"/*

RELOAD_UI_DETACHED=1 \
  RELOAD_UI_TEST_CALLS="$calls" \
  XDG_STATE_HOME="$test_root/state" \
  PATH="$mock_bin:$PATH" \
  "$reload_ui" --no-auto-open

mapfile -t recorded <"$calls"
[[ ${recorded[0]} == 'dot omarchy-shell-config' ]]
[[ ${recorded[1]} == 'omarchy restart shell' ]]
[[ ${recorded[2]} == 'omarchy shell shell rescanPlugins' ]]

printf 'reload-ui shell layout tests passed\n'
