#!/bin/bash
# Setup script for Claude Code cloud environments on the distro/cloud branch.
#
# Paste this into the environment's Setup script field:
#
#   curl -fsSL https://raw.githubusercontent.com/timmo001/dotfiles/distro/cloud/cloud/setup.sh | bash
#
# It clones the public dotfiles, installs mise and the pinned toolchain,
# builds dot and runs `dot cloud setup`, which also links the private
# dotfiles when they are attached to the session. The environment snapshots
# the result, so later sessions skip all of this, and the session start hook
# in the cloud settings brings it up to date. A failure is logged but never
# stops a session starting.
#
# Options (after `bash -s --` when piped):
#   --ref <branch>  Public dotfiles branch to clone (default: distro/cloud)
#   --force         Run as a non-root user outside a cloud session

set -uo pipefail

ref=distro/cloud
force=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --ref)
      ref=${2:?--ref needs a branch}
      shift 2
      ;;
    --force)
      force=true
      shift
      ;;
    *)
      echo "[WARN] Ignoring unknown option '$1'" >&2
      shift
      ;;
  esac
done

public=$HOME/.config/dotfiles
log_file=$HOME/.local/state/dot/cloud-setup.log

export PATH=$HOME/.local/bin:$PATH
export GIT_TERMINAL_PROMPT=0

# Follows the CI pin in .github/actions/setup-mise through Renovate.
MISE_VERSION="2026.10.15"

step() { printf '\n==> %s\n' "$*"; }

warn() { printf '[WARN] %s\n' "$*" >&2; }

# Clone a branch shallowly, or reset an existing clone to the remote. The
# clone is only read, and distro/cloud is force-pushed on every rebase, so a
# reset is always safe where a fast-forward would fail.
sync_repo() {
  local dir=$1 url=$2 branch=$3

  if [[ -d $dir/.git ]]; then
    git -C "$dir" fetch --quiet --depth=1 origin "$branch" &&
      git -C "$dir" checkout --quiet -B "$branch" FETCH_HEAD
  else
    git clone --quiet --depth=1 --branch "$branch" "$url" "$dir"
  fi
}

# Install the pinned mise from GitHub Releases, which the default Trusted
# network access allows, unlike mise.run and mise.jdx.dev.
install_mise() {
  local base=https://github.com/jdx/mise/releases/download/v$MISE_VERSION
  local asset=mise-v$MISE_VERSION-linux-x64 tmp status

  tmp=$(mktemp -d) || return
  curl -fsSL -o "$tmp/$asset" "$base/$asset" &&
    curl -fsSL -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt" &&
    (cd "$tmp" && grep " ./$asset\$" SHASUMS256.txt | sha256sum --check --status) &&
    install -D -m 755 "$tmp/$asset" "$HOME/.local/bin/mise"
  status=$?
  rm -rf "$tmp"

  return $status
}

main() {
  # Cloud setup scripts run as root; anywhere else this would replace the
  # user's own Claude Code settings.
  if [[ $EUID -ne 0 && ${CLAUDE_CODE_REMOTE:-} != true && $force != true ]]; then
    echo "[ERROR] Not a cloud environment setup script run; pass --force to run anyway" >&2
    return 1
  fi

  step "Dotfiles ($ref)"
  sync_repo "$public" https://github.com/timmo001/dotfiles.git "$ref" || return

  step "mise"
  if ! command -v mise >/dev/null; then
    install_mise || return
  fi
  mise --version

  step "Toolchain"
  cd "$public" || return
  mise trust --quiet "$public/mise.toml" || return
  # Only bun and node are needed to build dot; the rest are lint tools.
  mise install || warn "Some mise tools failed to install"

  step "Build dot"
  mise run dot:build ::: skills-maintenance:build || return
  mkdir -p "$HOME/.local/bin"
  for bin in dot skill-maintenance; do
    ln -sfn "$public/scripts/.local/bin/$bin" "$HOME/.local/bin/$bin"
  done

  step "dot cloud setup"
  dot cloud setup --force
}

mkdir -p "$(dirname "$log_file")"
started=$SECONDS
main 2>&1 | tee "$log_file"
status=${PIPESTATUS[0]}

if [[ $status -ne 0 ]]; then
  warn "Cloud setup failed (exit $status) after $((SECONDS - started))s; see $log_file"
else
  printf '\nCloud setup finished in %ss\n' "$((SECONDS - started))"
fi

exit 0
