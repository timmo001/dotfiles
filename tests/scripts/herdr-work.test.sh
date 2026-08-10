#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo_root/scripts/.local/bin/herdr-work"
test_dir=$(mktemp -d)
mock_bin="$test_dir/herdr"
calls="$test_dir/calls"
work_root="$test_dir/home-assistant"

trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$work_root/frontend"

cat >"$mock_bin" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$CALLS"

if [[ "$1 $2" == "status server" ]]; then
  [[ -z "${SERVER_STOPPED:-}" ]]
elif [[ "$1 $2" == "workspace list" ]]; then
  if [[ -n "${WORKSPACES:-}" ]]; then
    printf '%s\n' "$WORKSPACES"
  else
    printf '%s\n' '{"result":{"workspaces":[]}}'
  fi
elif [[ "$1 $2" == "workspace create" ]]; then
  printf '%s\n' '{"result":{"workspace":{"workspace_id":"created-frontend"}}}'
elif [[ "$1 $2" == "workspace focus" ]]; then
  printf '%s\n' '{"result":{}}'
fi
EOF

chmod +x "$mock_bin" "$script"
export CALLS="$calls"
export HERDR_ENV=1
export HERDR_WORK_HERDR_BIN="$mock_bin"
export HERDR_WORK_ROOT="$work_root"

"$script"
grep -Fx "workspace create --cwd $work_root/frontend --label Frontend --no-focus" "$calls"
grep -Fx 'workspace focus created-frontend' "$calls"

: >"$calls"
WORKSPACES='{"result":{"workspaces":[{"label":"Frontend","workspace_id":"w1"}]}}' "$script"
if grep -Fq 'workspace create' "$calls"; then
  printf '%s\n' 'existing workspace was recreated' >&2
  exit 1
fi
grep -Fx 'workspace focus w1' "$calls"

: >"$calls"
HERDR_ENV=0 WORKSPACES='{"result":{"workspaces":[{"label":"Frontend","workspace_id":"w1"}]}}' "$script"
grep -Fx 'session attach default' "$calls"
if grep -Fxq 'server' "$calls"; then
  printf '%s\n' 'herdr-work started a headless server directly' >&2
  exit 1
fi

: >"$calls"
if SERVER_STOPPED=1 "$script" 2>/dev/null; then
  printf '%s\n' 'herdr-work continued without the shared server' >&2
  exit 1
fi
if grep -Fxq 'server' "$calls"; then
  printf '%s\n' 'herdr-work started a headless server directly' >&2
  exit 1
fi

printf 'herdr-work tests passed\n'
