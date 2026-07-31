#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

mkdir -p "$temp_dir/bin"
cat >"$temp_dir/bin/git" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$GIT_CALLS"
case "$1 $2 $3" in
  "remote get-url upstream") exit "${UPSTREAM_STATUS:-0}" ;;
  "ls-remote --symref upstream"|"ls-remote --symref origin")
    printf 'ref: refs/heads/dev\tHEAD\n'
    ;;
  "symbolic-ref -q refs/remotes/upstream/HEAD"|"symbolic-ref -q refs/remotes/origin/HEAD")
    [[ -n "${LOCAL_REF:-}" ]] || exit 1
    printf '%s\n' "$LOCAL_REF"
    ;;
esac
EOF
cat >"$temp_dir/bin/dot" <<'EOF'
#!/usr/bin/env bash
exit "${AGENT_STATUS:-1}"
EOF
chmod +x "$temp_dir/bin/git" "$temp_dir/bin/dot"

GIT_CALLS="$temp_dir/match" \
  LOCAL_REF=refs/remotes/upstream/dev \
  PATH="$temp_dir/bin:$PATH" \
  "$repo_root/scripts/.local/bin/git-default-ref" >"$temp_dir/ref"
[[ "$(<"$temp_dir/ref")" == "upstream/dev" ]]
grep -Fxq 'fetch upstream +refs/heads/dev:refs/remotes/upstream/dev' "$temp_dir/match"

if GIT_CALLS="$temp_dir/agent" \
  LOCAL_REF=refs/remotes/upstream/main \
  AGENT_STATUS=0 \
  PATH="$temp_dir/bin:$PATH" \
  "$repo_root/scripts/.local/bin/git-default-ref" >/dev/null 2>"$temp_dir/error"; then
  echo "Expected mismatched agent resolution to fail" >&2
  exit 1
fi
grep -Fq 'Refusing to use upstream/dev' "$temp_dir/error"

if GIT_CALLS="$temp_dir/non-tty" \
  LOCAL_REF= \
  PATH="$temp_dir/bin:$PATH" \
  "$repo_root/scripts/.local/bin/git-default-ref" >/dev/null 2>"$temp_dir/non-tty-error"; then
  echo "Expected missing non-TTY resolution to fail" >&2
  exit 1
fi
grep -Fq 'local upstream/HEAD is missing' "$temp_dir/non-tty-error"

printf 'y\n' | GIT_CALLS="$temp_dir/human" \
  LOCAL_REF=refs/remotes/origin/main \
  UPSTREAM_STATUS=1 \
  PATH="$temp_dir/bin:$PATH" \
  script -qec "$repo_root/scripts/.local/bin/git-default-ref" /dev/null >"$temp_dir/human-output"
grep -Fxq 'remote set-head origin dev' "$temp_dir/human"
grep -Fxq 'fetch origin +refs/heads/dev:refs/remotes/origin/dev' "$temp_dir/human"
