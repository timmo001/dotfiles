#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
dot_binary="$repo_root/scripts/.local/bin/dot"
fixture="$(mktemp -d)"
poll_pid=""
real_git="$(command -v git)"

cleanup() {
  if [[ -n "$poll_pid" ]] && kill -0 "$poll_pid" 2>/dev/null; then
    kill "$poll_pid" 2>/dev/null || true
    wait "$poll_pid" 2>/dev/null || true
  fi
  rm -rf "$fixture"
}
trap cleanup EXIT

if [[ ! -x "$dot_binary" ]]; then
  printf 'Compiled dot binary is missing: %s\n' "$dot_binary" >&2
  exit 1
fi

git -C "$fixture" init -q
git -C "$fixture" config user.name Test
git -C "$fixture" config user.email test@example.com
printf 'base\n' >"$fixture/tracked"
git -C "$fixture" add tracked
git -C "$fixture" commit -qm base
base_branch="$(git -C "$fixture" branch --show-current)"
git -C "$fixture" switch -qc topic

for value in one two three; do
  printf '%s\n' "$value" >>"$fixture/tracked"
  git -C "$fixture" commit -qam "$value"
done

git -C "$fixture" switch -q "$base_branch"
printf 'upstream\n' >"$fixture/upstream"
git -C "$fixture" add upstream
git -C "$fixture" commit -qm upstream

mkdir "$fixture/bin"
cat >"$fixture/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "status" ]]; then
  printf 'unsafe\n' >>"$GIT_POLL_TRACE"
elif [[ "${1:-}" == "--no-optional-locks" && "${2:-}" == "status" ]]; then
  printf 'safe\n' >>"$GIT_POLL_TRACE"
fi

exec "$REAL_GIT" "$@"
EOF
chmod +x "$fixture/bin/git"

poll() {
  local attempt output
  for attempt in {1..40}; do
    output="$(
      DOTFILES_PUBLIC_DIR="$fixture" \
        DOT_ALLOW_PRIVATE=never \
        DOT_INCLUDE_OMARCHY_DIFF_REPOS=0 \
        DOT_NOTES_DIR="$fixture/missing-notes" \
        DOT_FETCH_TTL_SECONDS=300 \
        DOT_USAGE_DISABLE=1 \
        GIT_POLL_TRACE="$fixture/poll.trace" \
        REAL_GIT="$real_git" \
        PATH="$fixture/bin:$PATH" \
        "$dot_binary" git-diff --bar-json 2>>"$fixture/poll.stderr"
    )"
    jq -e 'type == "object"' <<<"$output" >/dev/null
  done
}

poll &
poll_pid=$!
git -C "$fixture" switch -q topic
git -C "$fixture" rebase "$base_branch" >/dev/null
wait "$poll_pid"
poll_pid=""

if [[ -s "$fixture/poll.stderr" ]] && grep -q 'index.lock' "$fixture/poll.stderr"; then
  printf 'Polling contended on the Git index lock:\n' >&2
  cat "$fixture/poll.stderr" >&2
  exit 1
fi

if grep -q '^unsafe$' "$fixture/poll.trace"; then
  printf 'Polling ran git status with optional index locking enabled.\n' >&2
  exit 1
fi

safe_polls="$(grep -c '^safe$' "$fixture/poll.trace")"
if ((safe_polls < 40)); then
  printf 'Expected at least 40 lock-safe status polls, got %s.\n' "$safe_polls" >&2
  exit 1
fi

DOTFILES_PUBLIC_DIR="$fixture" \
  DOT_ALLOW_PRIVATE=never \
  DOT_INCLUDE_OMARCHY_DIFF_REPOS=0 \
  DOT_NOTES_DIR="$fixture/missing-notes" \
  DOT_USAGE_DISABLE=1 \
  GIT_POLL_TRACE="$fixture/poll.trace" \
  REAL_GIT="$real_git" \
  PATH="$fixture/bin:$PATH" \
  "$dot_binary" git-diff --bar-json | jq -e 'type == "object"' >/dev/null

git -C "$fixture" merge-base --is-ancestor "$base_branch" HEAD
