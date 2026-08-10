#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
test_dir=$(mktemp -d)
mock_bin="$test_dir/bin"
calls="$test_dir/calls"

trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$mock_bin"

cat >"$mock_bin/herdr" <<'EOF'
#!/usr/bin/env bash
if [[ "$1 $2" == "workspace list" ]]; then
  printf '%s\n' "$HERDR_WORKSPACES"
  exit 0
fi
printf 'herdr %s\n' "$*" >>"$CALLS"
EOF

cat >"$mock_bin/herdr-repo-open" <<'EOF'
#!/usr/bin/env bash
printf 'herdr-repo-open %s\n' "$*" >>"$CALLS"
EOF

chmod +x "$mock_bin/herdr" "$mock_bin/herdr-repo-open"

export CALLS="$calls"
export PATH="$mock_bin:$PATH"
export HERDR_ENV=1
export HERDR_WORKSPACES='{"result":{"workspaces":[{"workspace_id":"w1","label":"Target"}]}}'

helper="$(awk '/^_repo_open\(\) \{/{found=1} found{print} found && /^\}/{exit}' "$repo_root/zsh/.zshrc")"
workspace_helper="$(awk '/^_repo_workspace\(\) \{/{found=1} found{print} found && /^\}/{exit}' "$repo_root/zsh/.zshrc")"

HERDR_WORKSPACE_ID=w1 zsh -dfc \
  "$helper; cd '$test_dir'; _repo_open Target '$repo_root'; print -r -- \"\$PWD\"" \
  >"$test_dir/current-workspace"

grep -Fx "$repo_root" "$test_dir/current-workspace"
if [[ -s "$calls" ]]; then
  printf 'repository opener delegated while already in the target workspace\n' >&2
  exit 1
fi

HERDR_WORKSPACE_ID=w2 zsh -dfc \
  "$helper; _repo_open Target '$repo_root'"
grep -Fx "herdr-repo-open Target $repo_root" "$calls"

: >"$calls"
HERDR_WORKSPACE_ID=w1 zsh -dfc \
  "$workspace_helper; cd '$test_dir'; _repo_workspace Target '$repo_root' Flow pwd" \
  >"$test_dir/current-workspace-command"
grep -Fx "$repo_root" "$test_dir/current-workspace-command"
if grep -Fq 'tab create' "$calls"; then
  printf 'repository command opened a tab while already in the target workspace\n' >&2
  exit 1
fi

printf 'repository shortcut tests passed\n'
