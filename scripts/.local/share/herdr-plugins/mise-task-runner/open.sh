#!/bin/sh
set -eu

directory="$PWD"
if [ -n "${HERDR_PLUGIN_CONTEXT_JSON:-}" ]; then
  resolved="$(node -e '
    try {
      const context = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON);
      const directory = context.focused_pane_cwd || context.workspace_cwd;
      if (typeof directory === "string" && directory) process.stdout.write(directory);
    } catch {}
  ')"
  if [ -n "$resolved" ]; then
    directory="$resolved"
  fi
fi

exec "${HERDR_BIN_PATH:-herdr}" plugin pane open \
  --plugin dotfiles.mise-task-runner \
  --entrypoint picker \
  --placement overlay \
  --env "MISE_TASK_DIRECTORY=$directory" \
  --focus
