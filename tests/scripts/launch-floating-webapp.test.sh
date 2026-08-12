#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo_root/scripts/.local/bin/launch-floating-webapp"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/hyprctl" <<'EOF'
#!/bin/bash
case "$1" in
  clients)
    if [[ -f $LAUNCHED ]]; then
      printf '[{"address":"0xnew","mapped":true,"class":"chrome-example.com__page-Default"}]\n'
    else
      printf '[]\n'
    fi
    ;;
  monitors)
    printf '[{"name":"DP-1","focused":true,"x":0,"y":0,"width":1920,"height":1080,"scale":1,"reserved":[0,30,10,40]}]\n'
    ;;
  dispatch)
    printf '%s\n' "$2" >>"$HYPRCTL_ARGS"
    ;;
esac
EOF
cat >"$tmp/omarchy-launch-webapp" <<'EOF'
#!/bin/bash
printf '%s\n' "$1" >"$LAUNCHED"
EOF
chmod +x "$tmp/hyprctl" "$tmp/omarchy-launch-webapp"

export LAUNCHED="$tmp/launched" HYPRCTL_ARGS="$tmp/hyprctl-args"
address=$(PATH="$tmp:$PATH" "$script" 'https://example.com:8123/page?x=1')

[ "$address" = '0xnew' ]
[ "$(<"$LAUNCHED")" = 'https://example.com:8123/page?x=1' ]
mapfile -t args <"$HYPRCTL_ARGS"
[[ ${args[0]} == *"action = 'enable', window = 'address:0xnew'"* ]]
[[ ${args[1]} == *"x = 380, y = 500, window = 'address:0xnew'"* ]]
[[ ${args[2]} == *"x = 1520, y = 534, window = 'address:0xnew'"* ]]
