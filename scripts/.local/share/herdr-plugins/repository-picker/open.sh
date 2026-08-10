#!/bin/sh
set -eu

exec "${HERDR_BIN_PATH:-herdr}" plugin pane open \
  --plugin dotfiles.repository-picker \
  --entrypoint picker \
  --placement overlay \
  --focus
