#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
update_script="$repo_root/scripts/.local/bin/update"
test_root=$(mktemp -d)
mock_bin="$test_root/bin"
mock_home="$test_root/home"
mkdir -p "$mock_bin" "$mock_home/.local/libexec"
trap 'rm -rf "$test_root"' EXIT

for command in dot pkexec topgrade; do
  printf '#!/bin/bash\nexit 0\n' >"$mock_bin/$command"
  chmod +x "$mock_bin/$command"
done

printf '#!/bin/bash\nexit 0\n' >"$mock_home/.local/libexec/update-sudo"
chmod +x "$mock_home/.local/libexec/update-sudo"

cat >"$mock_bin/gum" <<'EOF'
#!/bin/bash
printf 'Omarchy\n'
EOF
chmod +x "$mock_bin/gum"

cat >"$mock_bin/omarchy" <<'EOF'
#!/bin/bash
command -v sudo
EOF
chmod +x "$mock_bin/omarchy"

headless_output=$(HOME="$mock_home" PATH="$mock_bin:$PATH" "$update_script" -y)
[[ $headless_output == *"/sudo"* ]]
[[ $headless_output != *"/usr/bin/sudo"* ]]

interactive_output=$(script --quiet --return --command \
  "HOME='$mock_home' PATH='$mock_bin:$PATH' '$update_script'" /dev/null)
[[ $interactive_output == *"/usr/bin/sudo"* ]]

printf 'update privilege routing tests passed\n'
