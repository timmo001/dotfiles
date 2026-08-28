#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo_root/scripts/.local/bin/launch-floating-webapp"
dot_binary="$repo_root/scripts/.local/bin/dot"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

[[ -x $dot_binary ]]

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
  workspaces)
    printf '[{"id":3,"monitor":"DP-1"}]\n'
    ;;
  --batch)
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
address=$(PATH="$tmp:$PATH" "$script" --workspace 3 'https://example.com:8123/page?x=1')

[ "$address" = '0xnew' ]
[ "$(<"$LAUNCHED")" = 'https://example.com:8123/page?x=1' ]
mapfile -t args <"$HYPRCTL_ARGS"
[[ ${#args[@]} -eq 1 ]]
[[ ${args[0]} == "dispatch hl.dsp.window.move({ workspace = '3', window = 'address:0xnew', follow = false }) ; dispatch hl.dsp.window.float({ action = 'enable', window = 'address:0xnew' }) ; dispatch hl.dsp.window.resize({ x = 380, y = 500, window = 'address:0xnew' }) ; dispatch hl.dsp.window.move({ x = 1514, y = 534, window = 'address:0xnew' })" ]]

if "$script" --width invalid --address 0xexisting 2>"$tmp/error"; then
  printf 'invalid width unexpectedly succeeded\n' >&2
  exit 1
else
  status=$?
fi
[[ $status -eq 2 ]]
grep -Fx 'launch-floating-webapp: WIDTH must be a non-negative integer' "$tmp/error" >/dev/null
