#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
dot_binary="$repo_root/scripts/.local/bin/dot"

if [[ ! -x "$dot_binary" ]]; then
  printf 'Compiled dot binary is missing: %s\n' "$dot_binary" >&2
  exit 1
fi

commands=(
  init install update stow firewall doctor clean git-diff git-commit
  git-notifications agents-sync mcp-sync notes-capture-sync is-agent
  setup-private-repo private-pkg-publish skill-updates skill-check completions
  omarchy-plugin omarchy-shell-config launch-floating-webapp usage help
)

bare_help="$(DOT_USAGE_DISABLE=1 "$dot_binary")"
[[ "$bare_help" == *'Usage: dot [subcommand] [options]'* ]]

root_help="$(DOT_USAGE_DISABLE=1 "$dot_binary" --help)"
[[ "$root_help" == *'Usage: dot [subcommand] [options]'* ]]

for removed_command in dashboard tui omarchy; do
  if DOT_USAGE_DISABLE=1 "$dot_binary" "$removed_command" --help >/dev/null 2>&1; then
    printf 'Removed command still succeeds: dot %s\n' "$removed_command" >&2
    exit 1
  fi
done

for command in "${commands[@]}"; do
  help="$(DOT_USAGE_DISABLE=1 "$dot_binary" "$command" --help)"
  [[ "$help" == *"Usage: dot $command"* ]] || {
    printf 'Missing help usage for dot %s\n' "$command" >&2
    exit 1
  }
done

[[ "$(DOT_USAGE_DISABLE=1 "$dot_binary" diff --help)" == *'Usage: dot git-diff'* ]]
[[ "$(DOT_USAGE_DISABLE=1 "$dot_binary" up --help)" == *'Usage: dot update'* ]]

DOT_USAGE_DISABLE=1 "$dot_binary" git-diff --bar-json | jq -e 'type == "object"' >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-diff --panel-json | jq -e '.changed | type == "array"' >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-notifications --bar-json | jq -e 'type == "object"' >/dev/null

DOT_USAGE_DISABLE=1 "$dot_binary" git-diff >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-diff --raw >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-diff --list-changed >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-diff --list-all >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-notifications --raw >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-notifications --list-threads >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" usage path >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" usage summary --format agent-context >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-commit --dry-run -m "Test subject" >/dev/null
