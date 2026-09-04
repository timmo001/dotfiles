#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

cat >"$temp_dir/omarchy-menu-select" <<'EOF'
#!/usr/bin/env bash
count_file="${MENU_COUNT_FILE:?}"
count=0
[[ -f "$count_file" ]] && count="$(<"$count_file")"
count=$((count + 1))
printf '%s' "$count" >"$count_file"
if [[ $count -eq 1 ]]; then
  printf '%s\n' 'Setup workspace'
else
  printf '%s\n' "${MENU_SETUP_CHOICE:?}"
fi
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
  local count_file="$temp_dir/count-$choice"
  rm -f "$count_file" "$captured"
  set +e
  PATH="$temp_dir:$PATH" \
    OMARCHY_HOST=desktop \
    MENU_COUNT_FILE="$count_file" \
    MENU_SETUP_CHOICE="$choice" \
    CAPTURED_ARGS="$captured" \
    "$repo_root/scripts/.local/bin/workspace-menu"
  local status=$?
  set -e
  [[ $status -eq 23 ]]
}

captured_work="$temp_dir/args-work"
run_menu Work "$captured_work"
diff -u <(printf '%s\n' --mode=work) "$captured_work"

captured_normal="$temp_dir/args-normal"
run_menu Normal "$captured_normal"
diff -u <(printf '%s\n' --mode=normal) "$captured_normal"
