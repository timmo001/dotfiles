#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

cat >"$temp_dir/omarchy-menu-select" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"${MENU_ARGS:?}"
printf '%s\n' "${MENU_CHOICE:?}"
EOF
cat >"$temp_dir/workspace-setup" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"${CAPTURED_ARGS:?}"
exit 23
EOF
chmod +x "$temp_dir/omarchy-menu-select" "$temp_dir/workspace-setup"

run_menu() {
  local choice="$1"
  local captured="$2"
  rm -f "$captured"
  set +e
  PATH="$temp_dir:$PATH" \
    MENU_CHOICE="$choice" \
    MENU_ARGS="$temp_dir/menu-args" \
    CAPTURED_ARGS="$captured" \
    "$repo_root/scripts/.local/bin/workspace-menu"
  local status=$?
  set -e
  [[ $status -eq 23 ]]
}

captured_work="$temp_dir/args-work"
run_menu Work "$captured_work"
diff -u <(printf '%s\n' --mode=work) "$captured_work"
diff -u <(printf '%s\n' '󰋜  Normal' '󰣇  Work') <(grep -E '  (Normal|Work)$' "$temp_dir/menu-args")

captured_normal="$temp_dir/args-normal"
run_menu Normal "$captured_normal"
diff -u <(printf '%s\n' --mode=normal) "$captured_normal"
