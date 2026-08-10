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
  --style='full:rounded' \
  --layout=reverse \
  --padding=1 \
  --border-label=' Workspace ' \
  --border-label-pos=2 \
  --input-label=' Search ' \
  --input-label-pos=2 \
  --list-label=' Repositories ' \
  --list-label-pos=2 \
  --preview-label=' Git status ' \
  --preview-label-pos=2 \
  --prompt='> ' \
  --ghost='Type to filter repositories' \
  --info=inline-right \
  --pointer='>' \
  --highlight-line \
  --cycle \
  --scroll-off=3 \
  --no-scrollbar \
  --footer=' Enter open or focus  |  Esc close ' \
  --color='fg:#cdd6f4,bg:#1e1e2e,hl:#f38ba8,fg+:#cdd6f4,bg+:#313244,hl+:#f38ba8,info:#a6adc8,prompt:#cba6f7,pointer:#f5c2e7,spinner:#89b4fa,header:#9399b2,border:#45475a,label:#89b4fa,preview-border:#45475a,preview-label:#a6e3a1,list-border:#45475a,list-label:#89b4fa,input-border:#45475a,input-label:#cba6f7' \
  --preview='printf "%s\n" {2}; printf "\n"; git -C {2} status --short --branch 2>/dev/null || true' \
  --preview-window='right:45%,border-rounded')" || exit 0

tab="$(printf '\t')"
details="${selected#*"$tab"}"
directory="${details%%"$tab"*}"
label="${details#*"$tab"}"
exec herdr-repo-open "$label" "$directory"
