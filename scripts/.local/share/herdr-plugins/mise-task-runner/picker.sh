#!/bin/sh
set -eu

directory="${MISE_TASK_DIRECTORY:-$PWD}"

tasks="$(mise --cd "$directory" tasks --json --local 2>/dev/null)" || {
  echo "No trusted mise configuration found for $directory" >&2
  exit 1
}

if [ "$(printf '%s' "$tasks" | jq 'length')" -eq 0 ]; then
  echo "No local mise tasks found for $directory" >&2
  exit 1
fi

selected="$(printf '%s' "$tasks" | jq -r '.[] | [.name, (.description // "")] | @tsv' | fzf \
  --delimiter='\t' \
  --with-nth=1,2 \
  --style='full:rounded' \
  --layout=reverse \
  --padding=1 \
  --border-label=' Mise task ' \
  --border-label-pos=2 \
  --input-label=' Search ' \
  --input-label-pos=2 \
  --list-label=' Tasks ' \
  --list-label-pos=2 \
  --preview-label=' Task details ' \
  --preview-label-pos=2 \
  --prompt='> ' \
  --ghost='Type to filter tasks' \
  --info=inline-right \
  --pointer='>' \
  --highlight-line \
  --cycle \
  --scroll-off=3 \
  --no-scrollbar \
  --footer=' Enter run in new tab  |  Esc close ' \
  --color='fg:#cdd6f4,bg:#1e1e2e,hl:#f38ba8,fg+:#cdd6f4,bg+:#313244,hl+:#f38ba8,info:#a6adc8,prompt:#cba6f7,pointer:#f5c2e7,spinner:#89b4fa,header:#9399b2,border:#45475a,label:#89b4fa,preview-border:#45475a,preview-label:#a6e3a1,list-border:#45475a,list-label:#89b4fa,input-border:#45475a,input-label:#cba6f7' \
  --preview='mise --cd "$MISE_TASK_DIRECTORY" tasks info {1}' \
  --preview-window='right:50%,border-rounded')" || exit 0

tab="$(printf '\t')"
task="${selected%%"$tab"*}"

created="$("${HERDR_BIN_PATH:-herdr}" tab create \
  --workspace "$HERDR_WORKSPACE_ID" \
  --cwd "$directory" \
  --label "mise: $task" \
  --env "MISE_TASK=$task" \
  --focus)"
pane_id="$(printf '%s' "$created" | jq -r '.result.root_pane.pane_id // empty')"

if [ -z "$pane_id" ]; then
  echo "Herdr did not return a pane for mise task $task" >&2
  exit 1
fi

exec "${HERDR_BIN_PATH:-herdr}" pane run "$pane_id" 'mise run "$MISE_TASK"'
