#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

mkdir -p "$temp_dir/bin"
cat >"$temp_dir/bin/herdr" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$1 $2" in
  "status server") exit 0 ;;
  "workspace list")
    if [[ "$MODE" == "existing" ]]; then
      printf '{"result":{"workspaces":[{"workspace_id":"w1","active_tab_id":"w1:t1","label":"Dotfiles"}]}}\n'
    else
      printf '{"result":{"workspaces":[]}}\n'
    fi
    ;;
  "workspace create")
    printf 'create %s\n' "$*" >>"$CALLS"
    printf '{"result":{"workspace":{"workspace_id":"w2"},"tab":{"tab_id":"w2:t1"},"root_pane":{"pane_id":"w2:p1"}}}\n'
    ;;
  "tab create")
    printf 'create-tab %s\n' "$*" >>"$CALLS"
    printf '{"result":{"tab":{"tab_id":"w1:t2"},"root_pane":{"pane_id":"w1:p2"}}}\n'
    ;;
  "pane list")
    printf '{"result":{"panes":[{"pane_id":"w1:p1","tab_id":"w1:t1","focused":true}]}}\n'
    ;;
  "pane split")
    printf 'split %s\n' "$*" >>"$CALLS"
    printf '{"result":{"pane":{"pane_id":"w1:p2"}}}\n'
    ;;
  "pane focus") printf 'focus-pane %s\n' "$3" >>"$CALLS" ;;
  "tab rename") printf 'rename %s %s\n' "$3" "$4" >>"$CALLS" ;;
  "tab focus") printf 'focus-tab %s\n' "$3" >>"$CALLS" ;;
  "workspace focus") printf 'focus %s\n' "$3" >>"$CALLS" ;;
  "pane run") printf 'run %s %s\n' "$3" "$4" >>"$CALLS" ;;
  *) exit 2 ;;
esac
EOF
chmod +x "$temp_dir/bin/herdr"

cat >"$temp_dir/bin/pgrep" <<'EOF'
#!/usr/bin/env bash
[[ "$CLIENT_RUNNING" == "yes" ]]
EOF

cat >"$temp_dir/bin/uwsm" <<'EOF'
#!/usr/bin/env bash
printf 'launch %s\n' "$*" >>"$CALLS"
EOF
chmod +x "$temp_dir/bin/pgrep" "$temp_dir/bin/uwsm"

calls="$temp_dir/calls"
mkdir -p "$temp_dir/cache/dot"
printf '[{"name":"Dotfiles","path":"/repo"}]\n' >"$temp_dir/cache/dot/repo-picker.json"

PATH="$temp_dir/bin:$PATH" XDG_CACHE_HOME="$temp_dir/cache" MODE=existing CLIENT_RUNNING=yes CALLS="$calls" \
  "$repo_root/scripts/.local/bin/herdr-repo-open" dotfiles /repo OpenCode opencode
grep -Fx "create-tab tab create --workspace w1 --cwd /repo --label OpenCode --no-focus" "$calls"
grep -Fx "rename w1:t2 OpenCode" "$calls"
grep -Fx "run w1:p2 opencode" "$calls"
grep -Fx "focus w1" "$calls"
grep -Fx "focus-tab w1:t2" "$calls"

: >"$calls"
PATH="$temp_dir/bin:$PATH" XDG_CACHE_HOME="$temp_dir/cache" MODE=new CLIENT_RUNNING=yes CALLS="$calls" \
  "$repo_root/scripts/.local/bin/herdr-repo-open" dotfiles /repo OpenCode opencode
grep -Fx "create workspace create --cwd /repo --label Dotfiles --no-focus" "$calls"
grep -Fx "rename w2:t1 OpenCode" "$calls"
grep -Fx "run w2:p1 opencode" "$calls"
grep -Fx "focus w2" "$calls"
grep -Fx "focus-tab w2:t1" "$calls"

: >"$calls"
PATH="$temp_dir/bin:$PATH" XDG_CACHE_HOME="$temp_dir/cache" MODE=existing CLIENT_RUNNING=yes CALLS="$calls" \
  "$repo_root/scripts/.local/bin/herdr-repo-open" --pane dotfiles /repo Lazygit lazygit
grep -Fx "split pane split --pane w1:p1 --direction right --cwd /repo --focus" "$calls"
grep -Fx "run w1:p2 lazygit" "$calls"
grep -Fx "focus w1" "$calls"
grep -Fx "focus-pane w1:p2" "$calls"
if grep -Fq 'create-tab' "$calls"; then
  printf 'pane mode opened a tab\n' >&2
  exit 1
fi

: >"$calls"
PATH="$temp_dir/bin:$PATH" XDG_CACHE_HOME="$temp_dir/cache" MODE=existing CLIENT_RUNNING=no CALLS="$calls" \
  "$repo_root/scripts/.local/bin/herdr-repo-open" dotfiles /repo
grep -Fx "launch app -- ghostty-host-config -e herdr session attach default" "$calls"
grep -Fx "focus w1" "$calls"
