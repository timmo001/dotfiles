#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
singleton_stream="$repo_root/scripts/.local/bin/singleton-stream"
test_root=$(mktemp -d)
source_command="$test_root/source"
source_fds="$test_root/source-fds"
output="$test_root/output"
wrapper_pid=""

cleanup() {
  if [[ -n "$wrapper_pid" ]]; then
    kill "$wrapper_pid" 2>/dev/null || true
    wait "$wrapper_pid" 2>/dev/null || true
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT

cat >"$source_command" <<'EOF'
#!/bin/bash
for fd in /proc/$$/fd/*; do
  readlink "$fd" || true
done >"$1"
printf 'ready\n'
sleep 2
printf 'split-'
sleep 2
printf 'line\n'
printf 'done\n'
EOF
chmod +x "$source_command"

"$singleton_stream" \
  --key test \
  --parent-pid "$$" \
  --state-file "$test_root/state" \
  --lock-file "$test_root/lock" \
  -- "$source_command" "$source_fds" >"$output" &
wrapper_pid=$!

for _ in {1..40}; do
  if [[ -f "$output" ]] && (($(wc -l <"$output") >= 3)); then
    break
  fi
  sleep 0.1
done

mapfile -t lines <"$output"
[[ ${lines[0]:-} == "ready" ]]
[[ ${lines[1]:-} == "split-line" ]]
[[ ${lines[2]:-} == "done" ]]
! grep -Fxq "$test_root/lock" "$source_fds"

printf 'singleton-stream timeout tests passed\n'
