#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
sync_script="$repo_root/scripts/.local/bin/browser-control-extension-sync"
test_root=$(mktemp -d)
mock_bin="$test_root/bin"
install_root="$test_root/install"
extension_source="$install_root/node_modules/@opencode-ai/browser-control/extension/dist"
target="$test_root/data/browser-control/extension"
trap 'rm -rf "$test_root"' EXIT

mkdir -p "$mock_bin" "$extension_source" "$target"
printf '{"version":"0.0.23"}\n' >"$extension_source/manifest.json"
printf 'stale\n' >"$target/stale.txt"

cat >"$mock_bin/mise" <<EOF
#!/bin/bash
printf '%s\n' '$install_root'
EOF
chmod +x "$mock_bin/mise"

HOME="$test_root/home" XDG_DATA_HOME="$test_root/data" PATH="$mock_bin:$PATH" "$sync_script"

[[ $(jq -r .version "$target/manifest.json") == "0.0.23" ]]
[[ ! -e $target/stale.txt ]]
[[ -L $extension_source ]]
[[ $(readlink -f "$extension_source") == "$target" ]]

HOME="$test_root/home" XDG_DATA_HOME="$test_root/data" PATH="$mock_bin:$PATH" "$sync_script"

printf 'browser control extension sync tests passed\n'
