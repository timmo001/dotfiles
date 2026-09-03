#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

cat >"$temp_dir/dot" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$CAPTURED_ARGS"
exit 23
EOF
chmod +x "$temp_dir/dot"

captured="$temp_dir/args"
set +e
PATH="$temp_dir:$PATH" CAPTURED_ARGS="$captured" \
  "$repo_root/scripts/.local/bin/workspace-setup" --fast --temp-workspace=98
status=$?
set -e

[[ $status -eq 23 ]]
diff -u <(printf '%s\n' workspace-setup --fast --temp-workspace=98) "$captured"
