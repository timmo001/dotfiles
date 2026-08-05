#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
module="$repo_root/scripts/.local/bin/package-updates-bar"
test_dir=$(mktemp -d)
package_file="$test_dir/packages"
cache_dir="$test_dir/cache"
fake_yay="$test_dir/yay"
fake_pacman="$test_dir/pacman"
fake_pkill="$test_dir/pkill"

trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$cache_dir"

cat >"$fake_yay" <<'EOF'
#!/usr/bin/env bash
printf 'called\n' >>"$FAKE_YAY_CALLS_FILE"
case "$FAKE_YAY_RESULT" in
  none) exit 1 ;;
  http-error)
    printf 'status 429: Rate limit reached\n' >&2
    exit 1
    ;;
esac
EOF

cat >"$fake_pacman" <<'EOF'
#!/usr/bin/env bash
case "$1:$2:${3:-}" in
  -Qmq:--:example-bin) exit 0 ;;
esac
exit 1
EOF

printf '#!/usr/bin/env bash\nexit 0\n' >"$fake_pkill"
chmod +x "$fake_yay" "$fake_pacman" "$fake_pkill"

printf 'example-bin\n' >"$package_file"

export WAYBAR_PACKAGE_UPDATES_FILE="$package_file"
export WAYBAR_PACKAGE_UPDATES_CACHE_DIR="$cache_dir"
export WAYBAR_PACKAGE_UPDATES_YAY_BIN="$fake_yay"
export WAYBAR_PACKAGE_UPDATES_PACMAN_BIN="$fake_pacman"
export WAYBAR_PACKAGE_UPDATES_PKILL_BIN="$fake_pkill"
export FAKE_YAY_CALLS_FILE="$test_dir/yay-calls"

FAKE_YAY_RESULT=http-error "$module" refresh
[[ -s "$cache_dir/package-updates-waybar.backoff" ]]

calls_before=$(wc -l <"$FAKE_YAY_CALLS_FILE")
rm -rf "$cache_dir/package-updates-waybar.lock"
WAYBAR_PACKAGE_UPDATES_LOCKED=1 FAKE_YAY_RESULT=none "$module" refresh
calls_after=$(wc -l <"$FAKE_YAY_CALLS_FILE")
[[ "$calls_after" == "$calls_before" ]]

rm -rf "$cache_dir/package-updates-waybar.lock"
FAKE_YAY_RESULT=none "$module" refresh
[[ ! -e "$cache_dir/package-updates-waybar.backoff" ]]
jq -e '.text == "" and .class == "hidden"' "$cache_dir/package-updates-waybar.json" >/dev/null

printf 'package update refresh tests passed\n'
