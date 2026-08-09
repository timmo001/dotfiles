#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
update_script="$repo_root/scripts/.local/bin/update"
test_root=$(mktemp -d)
mock_bin="$test_root/bin"
mock_home="$test_root/home"
mkdir -p "$mock_bin" "$mock_home/.local/libexec"
trap 'rm -rf "$test_root"' EXIT

printf '#!/bin/bash\nexit 0\n' >"$mock_bin/pkexec"
chmod +x "$mock_bin/pkexec"

cat >"$mock_bin/dot" <<'EOF'
#!/bin/bash
if [[ ${1:-} == is-agent ]]; then
  exit 0
fi
printf 'dot args: %s\n' "$*"
EOF
chmod +x "$mock_bin/dot"

cat >"$mock_bin/topgrade" <<'EOF'
#!/bin/bash
printf 'topgrade args: %s\n' "$*"
EOF
chmod +x "$mock_bin/topgrade"

printf '#!/bin/bash\nexit 0\n' >"$mock_home/.local/libexec/update-sudo"
chmod +x "$mock_home/.local/libexec/update-sudo"

cat >"$mock_bin/gum" <<'EOF'
#!/bin/bash
menu_items=()
for arg in "$@"; do
  [[ $arg != --ordered ]] || exit 1
  case "$arg" in
    Dotfiles|Omarchy|Topgrade:*) menu_items+=("$arg") ;;
  esac
done
[[ ${menu_items[0]} == Dotfiles ]]
[[ ${menu_items[1]} == Omarchy ]]
[[ ${menu_items[2]} == 'Topgrade: Mise' ]]

case "${UPDATE_TEST_SELECTION:-default}" in
  default)
    printf '%s\n' 'Dotfiles' 'Omarchy' 'Topgrade: Mise' 'Topgrade: GitHub CLI extensions' 'Topgrade: Yazi'
    ;;
  all)
    printf '%s\n' \
      'Dotfiles' 'Omarchy' \
      'Topgrade: Mise' 'Topgrade: GitHub CLI extensions' 'Topgrade: Yazi' \
      'Topgrade: ProtonPlus' 'Topgrade: Firmware' 'Topgrade: Rustup' \
      'Topgrade: TLDR' 'Topgrade: Neovim' 'Topgrade: Containers' \
      'Topgrade: Claude Code' 'Topgrade: Claude Code plugins' 'Topgrade: uv'
    ;;
  omarchy)
    printf 'Omarchy\n'
    ;;
esac
EOF
chmod +x "$mock_bin/gum"

cat >"$mock_bin/omarchy" <<'EOF'
#!/bin/bash
printf 'omarchy args: %s\n' "$*"
command -v sudo
EOF
chmod +x "$mock_bin/omarchy"

headless_output=$(HOME="$mock_home" PATH="$mock_bin:$PATH" "$update_script" -y)
[[ $headless_output == *"/sudo"* || $headless_output == *"/sudo" ]]
[[ $headless_output != *"/usr/bin/sudo"* ]]
[[ $headless_output == *"topgrade args: -y"* ]]

interactive_output=$(script --quiet --return --command \
  "HOME='$mock_home' PATH='$mock_bin:$PATH' UPDATE_TEST_SELECTION=omarchy '$update_script'" /dev/null)
[[ $interactive_output == *"/usr/bin/sudo"* ]]

default_output=$(script --quiet --return --command \
  "HOME='$mock_home' PATH='$mock_bin:$PATH' UPDATE_TEST_SELECTION=default '$update_script'" /dev/null)
[[ $default_output == *"topgrade args: --only mise github_cli_extensions yazi"* ]]
[[ $default_output == *"dot args: update"*"omarchy args: update -y"*"topgrade args:"* ]]

all_output=$(script --quiet --return --command \
  "HOME='$mock_home' PATH='$mock_bin:$PATH' UPDATE_TEST_SELECTION=all '$update_script'" /dev/null)
[[ $all_output == *"topgrade args: "* ]]
[[ $all_output != *"topgrade args: --only"* ]]

printf 'update privilege routing tests passed\n'
