#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
update_script="$repo_root/scripts/.local/bin/update"
mock_bin=$(mktemp -d)
trap 'rm -rf "$mock_bin"' EXIT

for command in dot pkexec topgrade; do
  printf '#!/bin/bash\nexit 0\n' >"$mock_bin/$command"
  chmod +x "$mock_bin/$command"
done

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

headless_output=$(PATH="$mock_bin:$PATH" "$update_script" -y)
[[ $headless_output == *"/sudo"* ]]
[[ $headless_output != *"/usr/bin/sudo"* ]]

interactive_output=$(script --quiet --return --command \
  "PATH='$mock_bin:$PATH' '$update_script'" /dev/null)
[[ $interactive_output == *"/usr/bin/sudo"* ]]

printf 'update privilege routing tests passed\n'
