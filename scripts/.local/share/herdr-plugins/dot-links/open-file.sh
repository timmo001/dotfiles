#!/bin/sh
set -eu

parsed="$(node -e '
  const { fileURLToPath } = require("node:url");
  const url = new URL(process.argv[1]);
  const line = /^#L(\d+)/.exec(url.hash)?.[1] ?? "";
  url.hash = "";
  process.stdout.write(`${line}\n${fileURLToPath(url)}`);
' "$HERDR_PLUGIN_CLICKED_URL")"

line="${parsed%%
*}"
file="${parsed#*
}"

exec "${HERDR_BIN_PATH:-herdr}" plugin pane open \
  --plugin dotfiles.dot-links \
  --entrypoint editor \
  --placement split \
  --cwd "$(dirname "$file")" \
  --env "DOT_LINKS_FILE=$file" \
  --env "DOT_LINKS_LINE=${line:-1}"
