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

herdr="${HERDR_BIN_PATH:-herdr}"
opened="$("$herdr" plugin pane open \
  --plugin dotfiles.dot-links \
  --entrypoint editor \
  --placement split \
  --cwd "$(dirname "$file")" \
  --env "DOT_LINKS_FILE=$file" \
  --env "DOT_LINKS_LINE=${line:-1}" \
  --focus)"
pane_id="$(printf '%s' "$opened" | node -e '
  const input = require("node:fs").readFileSync(0, "utf8");
  process.stdout.write(JSON.parse(input).result.plugin_pane.pane.pane_id);
')"

# Focus returns to the clicked pane after a Ctrl+click opens the split, so refocus nvim.
sleep 0.3
"$herdr" plugin pane focus "$pane_id" >/dev/null
