#!/bin/sh
set -eu

cache_file="${XDG_CACHE_HOME:-$HOME/.cache}/dot/repo-picker.json"
if [ ! -r "$cache_file" ]; then
  echo "Repository picker cache is missing. Run: dot stow" >&2
  exit 1
fi

selected="$({
  printf 'Home\t%s\t\n' "$HOME"
  printf 'Repos\t%s/repos\t\n' "$HOME"
  jq -r '.[] | [.name, .path, .name] | @tsv' "$cache_file"
} | awk -F '\t' '!seen[$2]++' | fzf \
  --delimiter='\t' \
  --with-nth=1 \
  --prompt='Repository: ' \
  --header='Enter open or focus, Esc close' \
  --preview='printf "%s\n" {2}; printf "\n"; git -C {2} status --short --branch 2>/dev/null || true' \
  --preview-window='right:50%')" || exit 0

tab="$(printf '\t')"
details="${selected#*"$tab"}"
directory="${details%%"$tab"*}"
label="${details#*"$tab"}"
exec herdr-repo-open "$label" "$directory"
