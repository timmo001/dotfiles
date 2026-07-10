#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
dot_binary="$repo_root/scripts/.local/bin/dot"

if [[ ! -x "$dot_binary" ]]; then
  printf 'Compiled dot binary is missing: %s\n' "$dot_binary" >&2
  exit 1
fi

commands=(
  dashboard init install update stow firewall doctor clean git-diff git-commit
  git-log git-workflows git-notifications agents-sync mcp-sync is-agent
  setup-private-repo private-pkg-publish skill-updates skill-check completions
  omarchy usage help
)

root_help="$(DOT_USAGE_DISABLE=1 "$dot_binary" --help)"
[[ "$root_help" == *'Usage: dot [subcommand] [options]'* ]]

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
DOT_USAGE_DISABLE=1 "$dot_binary" git-notifications --bar-json | jq -e 'type == "object"' >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-workflows --bar-json | jq -e 'type == "object"' >/dev/null

DOT_USAGE_DISABLE=1 "$dot_binary" git-diff --raw >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-diff --list-changed >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-diff --list-all >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-log --raw >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-workflows --raw >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-workflows --list-repos >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-workflows --list-runs >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-notifications --raw >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-notifications --list-threads >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" usage path >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" usage summary --format agent-context >/dev/null
DOT_USAGE_DISABLE=1 "$dot_binary" git-commit --dry-run -m "Test subject" >/dev/null
