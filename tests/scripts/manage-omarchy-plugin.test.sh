#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

mkdir -p "$test_root/bin"
cat >"$test_root/bin/dot" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >"$DOT_ARGS"
exit "${DOT_EXIT:-0}"
EOF
chmod +x "$test_root/bin/dot"

DOT_ARGS="$test_root/args" PATH="$test_root/bin:$PATH" \
  "$repo_root/scripts/.local/bin/manage-omarchy-plugin" \
  update example.plugin 1
[[ $(<"$test_root/args") == 'omarchy-plugin update example.plugin 1' ]]

set +e
DOT_ARGS="$test_root/args" DOT_EXIT=20 PATH="$test_root/bin:$PATH" \
  "$repo_root/scripts/.local/bin/manage-omarchy-plugin" remove unmanaged.plugin 1
status=$?
set -e
[[ $status == 20 ]]

mkdir -p "$test_root/repo"
printf '{"plugins":[]}\n' >"$test_root/repo/omarchy-plugins.json"
for args in 'update example.plugin 1' 'remove example.plugin 1 0'; do
  set +e
  output=$(DOT_USAGE_DISABLE=1 DOTFILES_REPO="$test_root/repo" \
    PATH="$repo_root/scripts/.local/bin:$PATH" \
    "$repo_root/scripts/.local/bin/manage-omarchy-plugin" $args 2>&1)
  status=$?
  set -e
  [[ $status == 1 || $status == 20 ]]
  [[ "$output" != *'Unexpected argument'* ]]
done

printf 'Managed Omarchy plugin wrapper tests passed\n'
