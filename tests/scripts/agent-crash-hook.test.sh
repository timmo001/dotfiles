#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
hook="$repo_root/omarchy/.config/omarchy/hooks/agent-crash"
test_root=$(mktemp -d)
mock_bin="$test_root/bin"
herdr_log="$test_root/herdr.log"

trap 'rm -rf "$test_root"' EXIT
mkdir -p "$mock_bin" "$test_root/home"

cat >"$mock_bin/omarchy-default-agent" <<'EOF'
#!/bin/bash
printf 'opencode\n'
EOF

cat >"$mock_bin/herdr" <<'EOF'
#!/bin/bash
printf '%q ' "$@" >>"$HERDR_LOG"
printf '\n' >>"$HERDR_LOG"

case "${3:-} ${4:-}" in
  'api snapshot')
    printf '%s\n' '{"result":{"snapshot":{"panes":[]}}}'
    ;;
  'workspace create')
    printf '%s\n' '{"result":{"tab":{"tab_id":"w1:t1"},"root_pane":{"pane_id":"w1:p1"}}}'
    ;;
  'agent prompt')
    [[ ${HERDR_PROMPT_FAIL:-false} != true ]]
    ;;
esac
EOF

chmod +x "$mock_bin/herdr" "$mock_bin/omarchy-default-agent"

HOME="$test_root/home" HERDR_LOG="$herdr_log" PATH="$mock_bin:$PATH" \
  "$hook" 123 demo <<<"Diagnose demo"
grep -Fq -- 'agent prompt' "$herdr_log"
grep -Fq -- '--wait --until working --timeout 10000' "$herdr_log"

: >"$herdr_log"
if HOME="$test_root/home" HERDR_LOG="$herdr_log" HERDR_PROMPT_FAIL=true PATH="$mock_bin:$PATH" \
  "$hook" 123 demo <<<"Diagnose demo"; then
  printf 'hook accepted an unconfirmed prompt\n' >&2
  exit 1
fi
grep -Fq -- 'tab close w1:t1' "$herdr_log"

printf 'Agent crash hook tests passed\n'
