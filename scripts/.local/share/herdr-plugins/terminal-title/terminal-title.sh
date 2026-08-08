#!/bin/sh
set -eu

state_dir="${HERDR_PLUGIN_STATE_DIR:?}"
pid_file="$state_dir/watcher.pid"
log_file="$state_dir/watcher.log"
herdr_bin="${HERDR_BIN_PATH:-herdr}"
script="${HERDR_PLUGIN_ROOT:?}/terminal-title.sh"

running() {
  [ -f "$pid_file" ] || return 1
  pid="$(tr -d '[:space:]' <"$pid_file")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

sync_titles() {
  panes="$($herdr_bin pane list)"
  tabs="$($herdr_bin tab list)"

  printf '%s\n' "$panes" | jq -r '
    .result.panes
    | group_by(.tab_id)[]
    | (map(select(.focused)) | first) // first
    | select(.terminal_title_stripped != null and .terminal_title_stripped != "")
    | [.tab_id, .terminal_title_stripped] | @tsv
  ' | while IFS="$(printf '\t')" read -r tab_id title; do
    current="$(printf '%s\n' "$tabs" | jq -r --arg id "$tab_id" '.result.tabs[] | select(.tab_id == $id) | .label')"
    if [ "$current" != "$title" ]; then
      "$herdr_bin" tab rename "$tab_id" "$title" >/dev/null
    fi
  done
}

start() {
  mkdir -p "$state_dir"
  if running; then
    sync_titles
    return
  fi
  rm -f "$pid_file"
  setsid sh "$script" watch </dev/null >>"$log_file" 2>&1 &
  printf '%s\n' "$!" >"$pid_file"
}

case "${1:-}" in
start | autostart)
  start
  ;;
watch)
  while :; do
    sync_titles || true
    sleep 2
  done
  ;;
sync)
  sync_titles
  ;;
status)
  if running; then
    printf 'running (pid %s)\n' "$(tr -d '[:space:]' <"$pid_file")"
  else
    printf 'stopped\n'
    exit 1
  fi
  ;;
stop)
  if running; then
    kill "$(tr -d '[:space:]' <"$pid_file")"
  fi
  rm -f "$pid_file"
  ;;
*)
  printf 'usage: %s {start|stop|status|sync}\n' "$0" >&2
  exit 2
  ;;
esac
