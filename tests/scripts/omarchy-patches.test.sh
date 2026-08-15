#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo_root/scripts/.local/bin/apply-omarchy-patches"
patch_dir="$repo_root/scripts/.local/share/omarchy-patches"
test_root=$(mktemp -d)
target="$test_root/omarchy/bin/omarchy-agent-crash"
plugin_add="$test_root/omarchy/bin/omarchy-plugin-add"
plugin_update="$test_root/omarchy/bin/omarchy-plugin-update"
plugin_remove="$test_root/omarchy/bin/omarchy-plugin-remove"
mock_bin="$test_root/bin"
elevation_log="$test_root/elevation.log"

trap 'rm -rf "$test_root"' EXIT
mkdir -p "$(dirname "$target")" "$mock_bin"

cat >"$mock_bin/pkexec" <<'EOF'
#!/bin/bash
printf '%s\n' "$(basename "$0")" >>"$ELEVATION_LOG"
[[ ${PKEXEC_FAIL:-0} == 1 ]] && exit 127
chmod u+w "$ELEVATION_TARGET"
exec "$@"
EOF
chmod +x "$mock_bin/pkexec"

cat >"$mock_bin/sudo" <<'EOF'
#!/bin/bash
printf '%s\n' "$(basename "$0")" >>"$ELEVATION_LOG"
chmod u+w "$ELEVATION_TARGET"
exec "$@"
EOF
chmod +x "$mock_bin/sudo"

reset_target() {
  chmod u+w "$target" 2>/dev/null || true
  cat >"$target" <<'EOF'
#!/bin/bash
set -euo pipefail
pid=${1:?usage: omarchy-agent-crash <pid> [comm] [exe] [signal]}
comm=${2:-unknown}
exe=${3:-unknown}
signal=${4:-unknown}
when=unknown
prompt=$(
  cat <<PROMPT
Use the diagnose-crash skill for $comm ($pid, $exe, $signal, $when).
PROMPT
)

exec omarchy-agent --prompt "$prompt"
EOF
  if grep -Fq 'dispatch_hook=' "$target"; then
    patch --batch --fuzz=0 --reverse -d "$(dirname "$target")" -p2 \
      -i "$patch_dir/agent-crash-hook.patch" >/dev/null
  fi
}

reset_plugin_targets() {
  cp /usr/bin/omarchy-plugin-add "$plugin_add"
  cp /usr/bin/omarchy-plugin-update "$plugin_update"
  cp /usr/bin/omarchy-plugin-remove "$plugin_remove"
  chmod u+w "$plugin_add" "$plugin_update" "$plugin_remove"
  if grep -Fq 'lifecycle_hook=' "$plugin_add"; then
    patch --batch --fuzz=0 --reverse -d "$(dirname "$plugin_add")" -p2 \
      -i "$patch_dir/plugin-add-hook.patch" >/dev/null
  fi
  if grep -Fq 'lifecycle_hook=' "$plugin_update"; then
    patch --batch --fuzz=0 --reverse -d "$(dirname "$plugin_update")" -p2 \
      -i "$patch_dir/plugin-update-hook.patch" >/dev/null
  fi
  if grep -Fq 'lifecycle_hook=' "$plugin_remove"; then
    patch --batch --fuzz=0 --reverse -d "$(dirname "$plugin_remove")" -p2 \
      -i "$patch_dir/plugin-remove-hook.patch" >/dev/null
  fi
}

reset_target
reset_plugin_targets

XDG_DATA_HOME="$test_root/opencode-v2" OMARCHY_PATCH_ROOT="$test_root/omarchy" "$script"
printf -v marker 'dispatch_hook="$%s/.config/omarchy/hooks/agent-crash"' HOME
grep -Fq "$marker" "$target"
for plugin_target in "$plugin_add" "$plugin_update" "$plugin_remove"; do
  grep -Fq 'lifecycle_hook="$HOME/.config/omarchy/hooks/plugin-lifecycle"' "$plugin_target"
done

second_output=$(OMARCHY_PATCH_ROOT="$test_root/omarchy" OMARCHY_PATCH_DIR="$patch_dir" "$script")
grep -Fq 'Omarchy crash dispatch patch already applied' <<<"$second_output"
grep -Fq 'Omarchy plugin add patch already applied' <<<"$second_output"
grep -Fq 'Omarchy plugin update patch already applied' <<<"$second_output"
grep -Fq 'Omarchy plugin remove patch already applied' <<<"$second_output"

reset_target
reset_plugin_targets
chmod 444 "$target"
ELEVATION_LOG="$elevation_log" ELEVATION_TARGET="$target" PATH="$mock_bin:$PATH" \
  OMARCHY_PATCH_ROOT="$test_root/omarchy" OMARCHY_PATCH_DIR="$patch_dir" "$script"
[[ $(<"$elevation_log") == pkexec ]]

reset_target
reset_plugin_targets
chmod 444 "$target"
: >"$elevation_log"
script --quiet --return --command \
  "ELEVATION_LOG='$elevation_log' ELEVATION_TARGET='$target' PATH='$mock_bin:$PATH' OMARCHY_PATCH_ROOT='$test_root/omarchy' OMARCHY_PATCH_DIR='$patch_dir' '$script'" \
  /dev/null >/dev/null
[[ $(<"$elevation_log") == pkexec ]]

reset_target
reset_plugin_targets
chmod 444 "$target"
: >"$elevation_log"
PKEXEC_FAIL=1 ELEVATION_LOG="$elevation_log" ELEVATION_TARGET="$target" PATH="$mock_bin:$PATH" \
  OMARCHY_PATCH_ROOT="$test_root/omarchy" OMARCHY_PATCH_DIR="$patch_dir" "$script"
mapfile -t elevation_attempts <"$elevation_log"
[[ ${elevation_attempts[*]} == 'pkexec sudo' ]]

reset_target
source=$(<"$target")
printf '%s\n' "${source/exec omarchy-agent --prompt/exec changed-agent --prompt}" >"$target"
if OMARCHY_PATCH_ROOT="$test_root/omarchy" OMARCHY_PATCH_DIR="$patch_dir" "$script" 2>/dev/null; then
  printf 'patch accepted changed upstream input\n' >&2
  exit 1
fi

printf 'Omarchy patch tests passed\n'
