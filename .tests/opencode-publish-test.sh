#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

publish_dir="$temp_dir/publish"
mkdir -p "$publish_dir"
git -C "$publish_dir" init --quiet

(
  cd "$repo_root"
  DOTFILES_REPO=timmo001/dotfiles \
    PUBLISH_REPO=timmo001/opencode-config \
    OPENCODE_SOURCE_PREFIX=agents/.config/opencode \
    SKILLS_SOURCE_PREFIX=agents/.agents/skills \
    SOURCE_BRANCH=distro/arch-omarchy \
    PUBLISH_DIR="$publish_dir" \
    PUBLISH_DRY_RUN=1 \
    GITHUB_WORKSPACE="$repo_root" \
    .github/scripts/opencode-publish.sh >/dev/null
)

test -f "$publish_dir/lib/guard-paths.ts"
test -f "$publish_dir/lib/toast.ts"
test -f "$publish_dir/plugins/env-protection.ts"

js_import_config="$temp_dir/js-import-config"
mkdir -p "$js_import_config/agents" "$js_import_config/commands" "$js_import_config/plugins" "$js_import_config/lib"
printf '%s\n' 'import "../lib/helper.js"' >"$js_import_config/plugins/valid.ts"
printf '%s\n' 'export const helper = true' >"$js_import_config/lib/helper.ts"

(
  cd "$repo_root"
  DOTFILES_REPO=timmo001/dotfiles \
    PUBLISH_REPO=timmo001/opencode-config \
    OPENCODE_SOURCE_PREFIX="$js_import_config" \
    SKILLS_SOURCE_PREFIX=agents/.agents/skills \
    SOURCE_BRANCH=distro/arch-omarchy \
    PUBLISH_DIR="$publish_dir" \
    PUBLISH_DRY_RUN=1 \
    GITHUB_WORKSPACE="$repo_root" \
    .github/scripts/opencode-publish.sh >/dev/null
)

test -f "$publish_dir/lib/helper.ts"

invalid_config="$temp_dir/invalid-config"
invalid_skills="$temp_dir/invalid-skills"
mkdir -p "$invalid_config/plugins" "$invalid_config/lib" "$invalid_skills/example"
printf '%s\n' 'import "../lib/missing.js"' >"$invalid_config/plugins/broken.ts"
printf '%s\n' placeholder >"$invalid_config/lib/placeholder.ts"
printf '%s\n' placeholder >"$invalid_skills/example/SKILL.md"
printf '%s\n' keep >"$publish_dir/keep"

if (
  cd "$repo_root"
  DOTFILES_REPO=timmo001/dotfiles \
    PUBLISH_REPO=timmo001/opencode-config \
    OPENCODE_SOURCE_PREFIX="$invalid_config" \
    SKILLS_SOURCE_PREFIX="$invalid_skills" \
    SOURCE_BRANCH=distro/arch-omarchy \
    PUBLISH_DIR="$publish_dir" \
    PUBLISH_DRY_RUN=1 \
    GITHUB_WORKSPACE="$repo_root" \
    .github/scripts/opencode-publish.sh >/dev/null 2>&1
); then
  printf 'Publish validation accepted a missing plugin import.\n' >&2
  exit 1
fi

test -f "$publish_dir/keep"
