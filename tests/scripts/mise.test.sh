#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
mise_wrapper="$repo_root/scripts/.local/bin/mise"
test_root=$(mktemp -d)
mock_bin="$test_root/bin"
binary_bin="$test_root/binary-bin"
mock_home="$test_root/home"
mkdir -p "$mock_bin" "$binary_bin" "$mock_home"
trap 'rm -rf "$test_root"' EXIT

cat >"$mock_bin/mise" <<'EOF'
#!/bin/bash
printf 'args=%s\n' "$*"
printf 'global=%s\n' "${MISE_GLOBAL_CONFIG_FILE:-}"
printf 'claude_backend=%s\n' "${MISE_BACKENDS_CLAUDE:-}"
EOF
chmod +x "$mock_bin/mise"

run_mise() {
  HOME="$mock_home" XDG_STATE_HOME='' MISE_GLOBAL_CONFIG_FILE='' MISE_BACKENDS_CLAUDE='' PATH="$mock_bin:/usr/bin" "$mise_wrapper" "$@"
}

global_write=$(run_mise use -g gh)
[[ $global_write == *"args=use -g gh"* ]]
[[ $global_write == *"global=$mock_home/.local/state/mise/omarchy-config.toml"* ]]
[[ $global_write == *"claude_backend=http:claude"* ]]

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
[[ $local_write == $'args=use node@22\nglobal=\nclaude_backend=http:claude' ]]

read_command=$(run_mise current)
[[ $read_command == $'args=current\nglobal=\nclaude_backend=http:claude' ]]

explicit_write=$(run_mise --write-global-config use -g gh@2.97.0)
[[ $explicit_write == *"args=use -g gh@2.97.0"* ]]
[[ $explicit_write == $'args=use -g gh@2.97.0\nglobal=\nclaude_backend=' ]]

ln -s /usr/bin/perl "$binary_bin/mise"
perl_script="$test_root/argv0.pl"
cat >"$perl_script" <<'PERL'
open(my $fh, '<', "/proc/$$/cmdline") or die $!;
local $/;
my $data = <$fh>;
close $fh;
my @args = split /\0/, $data;
print $args[0], "\n";
PERL
shim="$binary_bin/starship"
ln -s "$mise_wrapper" "$shim"
shim_output=$(PATH="$binary_bin:/usr/bin" "$shim" "$perl_script")
[[ $shim_output == "$shim" ]]

printf 'mise global config guard tests passed\n'
