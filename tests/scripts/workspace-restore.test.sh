#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

mkdir -p "$temp_dir/bin" "$temp_dir/state"
cat >"$temp_dir/bin/hyprctl" <<'EOF'
#!/usr/bin/env bash
printf '[]\n'
EOF
cat >"$temp_dir/bin/omarchy-launch-webapp" <<'EOF'
#!/usr/bin/env bash
printf '%s' "$1" >"$CAPTURED_ARG_FILE"
EOF
chmod +x "$temp_dir/bin/hyprctl"
chmod +x "$temp_dir/bin/omarchy-launch-webapp"

session_file="$temp_dir/state/workspace-test.json"
injection_marker="$temp_dir/injected"
hostile_url="https://example.com/?a=1&b=\$(touch $injection_marker)'quote"
jq -n --arg url "$hostile_url" '{
  active_workspace: {},
  clients: [{
    address: "0x1",
    browser_url: $url,
    class: "chrome-example.com__app",
    initialClass: "",
    title: "Example",
    workspace: { id: 1 }
  }]
}' >"$session_file"

output="$(
  PATH="$temp_dir/bin:$PATH" \
    "$repo_root/scripts/.local/bin/workspace-restore" \
    --dry-run \
    --file="$session_file" \
    --state-dir="$temp_dir/state"
)"

launch_line="$(printf '%s\n' "$output" | grep -F 'Would launch chrome-example.com__app (Example) for workspace 1:')"
launch_command="${launch_line#*: }"
if [[ "$launch_command" != omarchy-launch-webapp\ * ]]; then
  printf 'Expected quoted launch command not found.\nOutput:\n%s\n' "$output" >&2
  exit 1
fi

captured_arg_file="$temp_dir/captured-arg"
PATH="$temp_dir/bin:$PATH" CAPTURED_ARG_FILE="$captured_arg_file" /bin/sh -c "$launch_command"

if [[ "$(<"$captured_arg_file")" != "$hostile_url" ]]; then
  printf 'Browser URL was not preserved as one argument.\n' >&2
  exit 1
fi

if [[ -e "$injection_marker" ]]; then
  printf 'Hostile URL executed command substitution.\n' >&2
  exit 1
fi
