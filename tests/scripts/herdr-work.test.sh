#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo_root/scripts/.local/bin/herdr-work"
test_dir=$(mktemp -d)
mock_bin="$test_dir/herdr"
calls="$test_dir/calls"
server_state="$test_dir/server-state"
work_root="$test_dir/home-assistant"

trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$work_root/frontend" "$work_root/core" "$work_root/home-assistant.io" "$work_root/developers.home-assistant"

cat >"$mock_bin" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$CALLS"

if [[ "$1" == "server" ]]; then
  touch "$SERVER_STATE"
elif [[ "$1 $2" == "status server" ]]; then
  [[ -z "${SERVER_STATE:-}" || -e "$SERVER_STATE" ]]
elif [[ "$1 $2" == "workspace list" ]]; then
  if [[ -n "${WORKSPACES:-}" ]]; then
    printf '%s\n' "$WORKSPACES"
  else
    printf '%s\n' '{"result":{"workspaces":[]}}'
  fi
elif [[ "$1 $2" == "workspace create" ]]; then
  label=""
  while (($#)); do
    if [[ "$1" == "--label" ]]; then
      label="$2"
      break
    fi
    shift
  done
  printf '{"result":{"workspace":{"workspace_id":"created-%s"}}}\n' "${label// /-}"
elif [[ "$1 $2" == "workspace focus" ]]; then
  printf '%s\n' '{"result":{}}'
fi
EOF

chmod +x "$mock_bin"
export CALLS="$calls"
export HERDR_ENV=1
export HERDR_WORK_HERDR_BIN="$mock_bin"
export HERDR_WORK_ROOT="$work_root"

"$script"
grep -Fx "workspace create --cwd $work_root/frontend --label Frontend --no-focus" "$calls"
grep -Fx 'workspace focus created-Frontend' "$calls"

: >"$calls"
"$script" core docs dev-docs
grep -Fx "workspace create --cwd $work_root/core --label Core --no-focus" "$calls"
grep -Fx "workspace create --cwd $work_root/home-assistant.io --label Docs --no-focus" "$calls"
grep -Fx "workspace create --cwd $work_root/developers.home-assistant --label Dev Docs --no-focus" "$calls"
grep -Fx 'workspace focus created-Frontend' "$calls"

: >"$calls"
WORKSPACES='{"result":{"workspaces":[{"label":"Frontend","workspace_id":"w1"},{"label":"Core","workspace_id":"w2"}]}}' "$script" core
if grep -Fq 'workspace create' "$calls"; then
  printf '%s\n' 'existing workspaces were recreated' >&2
  exit 1
fi
grep -Fx 'workspace focus w1' "$calls"

: >"$calls"
rm -f "$server_state"
SERVER_STATE="$server_state" "$script"
grep -Fx 'server' "$calls"
grep -Fx 'workspace create --cwd '"$work_root"'/frontend --label Frontend --no-focus' "$calls"

printf 'herdr-work tests passed\n'
