#!/bin/sh
# Opens a Dotfiles workspace in the dotfiles checkout this plugin comes from, unless the session
# already has one, so a new session starts there rather than in ~.
set -eu

herdr_bin="${HERDR_BIN_PATH:-herdr}"
dotfiles="$(cd "${HERDR_PLUGIN_ROOT:?}/../../../../.." && pwd)"

if "$herdr_bin" workspace list | jq -e '.result.workspaces | any(.label == "Dotfiles")' >/dev/null; then
  exit 0
fi

"$herdr_bin" workspace create --cwd "$dotfiles" --label Dotfiles --focus >/dev/null
