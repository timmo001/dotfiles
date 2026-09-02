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
  setup-private-repo private-pkg-publish skills completions
  omarchy-plugin omarchy-shell-config agent-oxlint launch-floating-webapp usage help
)

bare_help="$(DOT_USAGE_DISABLE=1 "$dot_binary")"
[[ "$bare_help" == *$'USAGE\n  dot <subcommand> [flags]'* ]]

root_help="$(DOT_USAGE_DISABLE=1 "$dot_binary" --help)"
[[ "$root_help" == *$'USAGE\n  dot <subcommand> [flags]'* ]]

for removed_command in dashboard tui omarchy; do
  if DOT_USAGE_DISABLE=1 "$dot_binary" "$removed_command" --help >/dev/null 2>&1; then
    printf 'Removed command still succeeds: dot %s\n' "$removed_command" >&2
    exit 1
  fi
done

for removed_command in skill-updates skill-check skill-updates-agent; do
  if DOT_USAGE_DISABLE=1 "$dot_binary" "$removed_command" --help >/dev/null 2>&1; then
    printf 'Removed command still succeeds: dot %s\n' "$removed_command" >&2
    exit 1
  fi
done

for command in validate import updates check updates-agent; do
  help="$(DOT_USAGE_DISABLE=1 "$dot_binary" skills "$command" --help)"
  [[ "$help" == *"dot skills $command"* ]] || {
    printf 'Missing help usage for dot skills %s\n' "$command" >&2
    exit 1
  }
done

for mode in github device; do
  help="$(DOT_USAGE_DISABLE=1 "$dot_binary" skills updates-agent "$mode" --help)"
  [[ "$help" == *"dot skills updates-agent $mode"* ]] || {
    printf 'Missing help usage for dot skills updates-agent %s\n' "$mode" >&2
    exit 1
  }
done

for command in "${commands[@]}"; do
  help="$(DOT_USAGE_DISABLE=1 "$dot_binary" "$command" --help)"
  [[ "$help" == *$'USAGE\n  '"dot $command"* ]] || {
    printf 'Missing help usage for dot %s\n' "$command" >&2
    exit 1
  }
done

[[ "$(DOT_USAGE_DISABLE=1 "$dot_binary" diff --help)" == *$'USAGE\n  dot git-diff'* ]]
[[ "$(DOT_USAGE_DISABLE=1 "$dot_binary" up --help)" == *$'USAGE\n  dot update'* ]]

for malformed in \
  'git-commit ---m Test --dry-run' \
  'is-agent ---q' \
  'workspace-capture ----current --help' \
  'workspace-restore ----dryrun --help' \
  'workspace-restore --no-no-launch --dry-run' \
  'update --no-no-self-update --help' \
  '--no-help'; do
  if DOT_USAGE_DISABLE=1 "$dot_binary" $malformed >/dev/null 2>&1; then
    printf 'Malformed option still succeeds: dot %s\n' "$malformed" >&2
    exit 1
  fi
done

set +e
dryrun_output=$(DOT_USAGE_DISABLE=1 "$dot_binary" workspace-restore --dryrun 2>&1)
set -e
[[ "$dryrun_output" != *'Unrecognized flag'* ]]

set +e
DOT_USAGE_DISABLE=1 "$dot_binary" launch-floating-webapp >/dev/null 2>&1
[[ $? == 2 ]]
DOT_USAGE_DISABLE=1 "$dot_binary" herdr-repo-open >/dev/null 2>&1
[[ $? == 2 ]]
DOT_USAGE_DISABLE=1 "$dot_binary" launch-floating-webapp --width 0 https://example.com >/dev/null 2>&1
[[ $? == 2 ]]
DOT_USAGE_DISABLE=1 "$dot_binary" launch-floating-webapp --right-margin -1 https://example.com >/dev/null 2>&1
[[ $? == 2 ]]
set -e

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
