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

printf 'Managed Omarchy plugin wrapper tests passed\n'
