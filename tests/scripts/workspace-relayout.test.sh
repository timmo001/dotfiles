#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

mkdir -p "$temp_dir/bin" "$temp_dir/data/workspace-relayout"
cp "$repo_root/scripts/.local/share/workspace-relayout/presets.json" "$temp_dir/data/workspace-relayout/presets.json"

cat >"$temp_dir/bin/hyprctl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$HYPRCTL_LOG"

case "$*" in
  '-j activeworkspace')
    printf '%s\n' '{"id":1,"name":"Test"}'
    ;;
  '-j clients')
    printf '%s\n' '[
      {"address":"0x1","mapped":true,"hidden":false,"floating":false,"workspace":{"id":1},"at":[0,0],"size":[1000,750]},
      {"address":"0x2","mapped":true,"hidden":false,"floating":false,"workspace":{"id":1},"at":[0,750],"size":[1000,250]}
    ]'
    ;;
  'activewindow -j')
    printf '%s\n' '{"address":"0x1","workspace":{"id":1}}'
    ;;
esac
EOF

cat >"$temp_dir/bin/omarchy-launch-walker" <<'EOF'
#!/usr/bin/env bash
count=0
if [[ -f "$WALKER_COUNT_FILE" ]]; then
  count="$(<"$WALKER_COUNT_FILE")"
fi
count=$((count + 1))
printf '%s' "$count" >"$WALKER_COUNT_FILE"
cat >"$WALKER_LOG_DIR/menu-$count"
sed -n "${count}p" "$WALKER_RESPONSES"
EOF

cat >"$temp_dir/bin/omarchy" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$NOTIFICATION_LOG"
EOF

chmod +x "$temp_dir/bin/hyprctl" "$temp_dir/bin/omarchy-launch-walker" "$temp_dir/bin/omarchy"

run_relayout() {
  local case_dir="$1"
  shift

  mkdir -p "$case_dir/menus"
  : >"$case_dir/hyprctl.log"
  : >"$case_dir/notifications.log"

  PATH="$temp_dir/bin:$PATH" \
    XDG_DATA_HOME="$temp_dir/data" \
    HYPRCTL_LOG="$case_dir/hyprctl.log" \
    NOTIFICATION_LOG="$case_dir/notifications.log" \
    WALKER_COUNT_FILE="$case_dir/walker-count" \
    WALKER_LOG_DIR="$case_dir/menus" \
    WALKER_RESPONSES="$case_dir/responses" \
    "$repo_root/scripts/.local/bin/workspace-relayout" "$@"
}

apply_dir="$temp_dir/apply"
mkdir -p "$apply_dir"
printf '%s\n' 'Top / bottom' '75% top [75/25]' >"$apply_dir/responses"
run_relayout "$apply_dir"

mapfile -t apply_groups <"$apply_dir/menus/menu-1"
if [[ "${apply_groups[*]}" != 'Top / bottom Left / right' ]]; then
  printf 'Unexpected two-window family order: %s\n' "${apply_groups[*]}" >&2
  exit 1
fi

mapfile -t top_bottom_presets <"$apply_dir/menus/menu-2"
if [[ "${top_bottom_presets[*]}" != '75% top [75/25] 63% top [63/37] Equal height [50/50]' ]]; then
  printf 'Unexpected top/bottom preset order: %s\n' "${top_bottom_presets[*]}" >&2
  exit 1
fi

if ! grep -Fq 'dispatch layoutmsg splitratio 1.5058 exact' "$apply_dir/hyprctl.log"; then
  printf 'Selected 75%% top layout was not applied.\n' >&2
  exit 1
fi

edit_dir="$temp_dir/edit"
mkdir -p "$edit_dir"
printf '%s\n' 'Left / right' 'Equal width [50/50]' >"$edit_dir/responses"
run_relayout "$edit_dir" --edit

if grep -Fq 'top' "$edit_dir/menus/menu-2"; then
  printf 'Edit menu included a preset from another family.\n' >&2
  exit 1
fi

mapfile -t left_right_presets <"$edit_dir/menus/menu-2"
if [[ "${left_right_presets[*]:0:4}" != 'Equal width [50/50] 33% left [33/67] 25% left [25/75] 19% left [19/81]' || "${left_right_presets[4]}" != *'Add new layout' ]]; then
  printf 'Unexpected left/right edit order: %s\n' "${left_right_presets[*]}" >&2
  exit 1
fi

if ! jq -e '.layouts["2"][3].group == "Left / right" and .layouts["2"][3].tree.dir == "tb" and .layouts["2"][0].tree.ratio == 75.29' "$temp_dir/data/workspace-relayout/presets.json" >/dev/null; then
  printf 'Edit mode did not overwrite the selected family preset by its original index.\n' >&2
  exit 1
fi
