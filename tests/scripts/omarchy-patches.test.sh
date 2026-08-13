#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo_root/scripts/.local/bin/apply-omarchy-patches"
patch_dir="$repo_root/scripts/.local/share/omarchy-patches"
test_root=$(mktemp -d)
target="$test_root/omarchy/bin/omarchy-agent-crash"

trap 'rm -rf "$test_root"' EXIT
mkdir -p "$(dirname "$target")"

reset_target() {
  cp /usr/share/omarchy/bin/omarchy-agent-crash "$target"
  if grep -Fq 'dispatch_hook=' "$target"; then
    patch --batch --fuzz=0 --reverse -d "$(dirname "$target")" -p2 \
      -i "$patch_dir/agent-crash-hook.patch" >/dev/null
  fi
}

reset_target

XDG_DATA_HOME="$test_root/opencode-v2" OMARCHY_PATCH_ROOT="$test_root/omarchy" "$script"
printf -v marker 'dispatch_hook="$%s/.config/omarchy/hooks/agent-crash"' HOME
grep -Fq "$marker" "$target"

second_output=$(OMARCHY_PATCH_ROOT="$test_root/omarchy" OMARCHY_PATCH_DIR="$patch_dir" "$script")
[[ $second_output == 'Omarchy crash dispatch patch already applied' ]]

reset_target
source=$(<"$target")
printf '%s\n' "${source/exec omarchy-agent --prompt/exec changed-agent --prompt}" >"$target"
if OMARCHY_PATCH_ROOT="$test_root/omarchy" OMARCHY_PATCH_DIR="$patch_dir" "$script" 2>/dev/null; then
  printf 'patch accepted changed upstream input\n' >&2
  exit 1
fi

printf 'Omarchy patch tests passed\n'
