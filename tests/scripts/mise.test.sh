#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
mise_wrapper="$repo_root/scripts/.local/bin/mise"
test_root=$(mktemp -d)
mock_bin="$test_root/bin"
mock_home="$test_root/home"
mkdir -p "$mock_bin" "$mock_home"
trap 'rm -rf "$test_root"' EXIT

cat >"$mock_bin/mise" <<'EOF'
#!/bin/bash
printf 'args=%s\n' "$*"
printf 'global=%s\n' "${MISE_GLOBAL_CONFIG_FILE:-}"
EOF
chmod +x "$mock_bin/mise"

run_mise() {
  HOME="$mock_home" XDG_STATE_HOME='' PATH="$mock_bin:/usr/bin" "$mise_wrapper" "$@"
}

global_write=$(run_mise use -g gh)
[[ $global_write == *"args=use -g gh"* ]]
[[ $global_write == *"global=$mock_home/.local/state/mise/omarchy-config.toml"* ]]

long_global_write=$(run_mise use --global node@latest)
[[ $long_global_write == *"global=$mock_home/.local/state/mise/omarchy-config.toml"* ]]

settings_write=$(run_mise settings add idiomatic_version_file_enable_tools ruby)
[[ $settings_write == *"global=$mock_home/.local/state/mise/omarchy-config.toml"* ]]

global_remove=$(run_mise rm -g node)
[[ $global_remove == *"global=$mock_home/.local/state/mise/omarchy-config.toml"* ]]

global_unuse=$(run_mise unuse --global node)
[[ $global_unuse == *"global=$mock_home/.local/state/mise/omarchy-config.toml"* ]]

local_write=$(run_mise use node@22)
[[ $local_write == *"args=use node@22"* ]]
[[ $local_write == $'args=use node@22\nglobal=' ]]

read_command=$(run_mise current)
[[ $read_command == $'args=current\nglobal=' ]]

explicit_write=$(run_mise --write-global-config use -g gh@2.97.0)
[[ $explicit_write == *"args=use -g gh@2.97.0"* ]]
[[ $explicit_write == $'args=use -g gh@2.97.0\nglobal=' ]]

printf 'mise global config guard tests passed\n'
