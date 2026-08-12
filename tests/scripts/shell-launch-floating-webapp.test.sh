#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo_root/scripts/.local/bin/shell-launch-floating-webapp"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/hyprctl" <<'EOF'
#!/bin/bash
if [[ $1 == clients ]]; then
  if [[ -f $LAUNCHED ]]; then
    printf '[{"address":"0xnew","class":"chrome-example.com__page-Default"}]\n'
  else
    printf '[]\n'
  fi
else
  printf '%s\n' "$@" >"$HYPRCTL_ARGS"
fi
EOF
cat >"$tmp/omarchy-launch-webapp" <<'EOF'
#!/bin/bash
printf '%s\n' "$1" >"$LAUNCHED"
EOF
chmod +x "$tmp/hyprctl" "$tmp/omarchy-launch-webapp"

export LAUNCHED="$tmp/launched" HYPRCTL_ARGS="$tmp/hyprctl-args"
PATH="$tmp:$PATH" "$script" 'https://example.com:8123/page?x=1'

[ "$(<"$LAUNCHED")" = 'https://example.com:8123/page?x=1' ]
mapfile -t args <"$HYPRCTL_ARGS"
[ "${args[0]}" = "--batch" ]
[[ ${args[1]} == *"action = 'enable', window = 'address:0xnew'"* ]]
[[ ${args[1]} == *"x = 875, y = 600, window = 'address:0xnew'"* ]]
[[ ${args[1]} == *"center({ window = 'address:0xnew' })"* ]]
