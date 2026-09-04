#!/usr/bin/env bash
# Generates README.md and AGENTS.md from the live opencode config, then
# syncs the subtree contents into the target publish repo and pushes.
#
# Expected environment:
#   DOTFILES_REPO          - owner/repo of the dotfiles source (e.g. timmo001/dotfiles)
#   PUBLISH_REPO           - owner/repo of the target publish repo (e.g. timmo001/opencode-config)
#   SKILLS_REPO            - owner/repo of the shared skills source (e.g. timmo001/skills)
#   OPENCODE_SOURCE_PREFIX - OpenCode config path within dotfiles (e.g. agents/.config/opencode)
#   SKILLS_SOURCE_PREFIX   - shared skills path within dotfiles (e.g. agents/.agents/skills)
#   SOURCE_BRANCH          - branch name in dotfiles repo (e.g. distro/arch-omarchy)
#   PUBLISH_DIR            - local checkout of the publish repo
set -euo pipefail

OPENCODE_SOURCE_PREFIX="${OPENCODE_SOURCE_PREFIX:-${SOURCE_PREFIX:-agents/.config/opencode}}"
SKILLS_SOURCE_PREFIX="${SKILLS_SOURCE_PREFIX:-agents/.agents/skills}"
SKILLS_REPO="${SKILLS_REPO:-${DOTFILES_REPO%/*}/skills}"
CONFIG_DIR="${OPENCODE_SOURCE_PREFIX}"
SKILLS_DIR="${SKILLS_SOURCE_PREFIX}"
DOTFILES_URL="https://github.com/${DOTFILES_REPO}"
SKILLS_URL="https://github.com/${SKILLS_REPO}"
OPENCODE_SOURCE_URL="${DOTFILES_URL}/tree/${SOURCE_BRANCH}/${OPENCODE_SOURCE_PREFIX}"
SKILLS_SOURCE_URL="${SKILLS_URL}/tree/main"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Extract a scalar field from a file's YAML frontmatter.
field() {
  local file="$1" f="$2"
  awk -v f="$f" '
    NR==1 && /^---/ { fm=1; next }
    fm && /^---/ { exit }
    !fm { next }
    $0 ~ "^"f": " || $0 ~ "^"f":$" {
      v = $0; sub("^"f":[ ]*", "", v)
      gsub(/^[\x22\x27]|[\x22\x27]$/, "", v)
      if (v ~ /^[>|][-]?$/ || v == "") { ml=1; next }
      r = v; exit
    }
    ml && /^  / { sub(/^  +/, ""); r = r ? r " " $0 : $0; next }
    ml { exit }
    END { print r }
  ' "$file"
}

# Extract the # origin: URL from a skill's YAML frontmatter comment.
origin() {
  awk '
    NR==1 && /^---/ { fm=1; next }
    fm && /^---/ { exit }
    fm && /^# origin:/ { sub(/^# origin: */, ""); print; exit }
  ' "$1"
}

# List hard dependencies (plugins and skills loaded before execution).
requires() {
  local file="$1" deps=()
  if grep -qi 'BranchContextPlugin\|branch-context' "$file" 2>/dev/null; then
    deps+=('`branch-context` plugin')
  fi
  if grep -qi 'StackContextPlugin\|stack-context' "$file" 2>/dev/null; then
    deps+=('`stack-context` plugin')
  fi
  local ref
  for ref in $(grep -P '[Ll]oad\b.*`[a-z][-a-z0-9]*`' "$file" 2>/dev/null |
    grep -oP '`[a-z][-a-z0-9]*`' | tr -d '`' | sort -u); do
    if [[ -d "${SKILLS_DIR}/${ref}" ]]; then
      local self
      self="$(basename "$(dirname "$file")")"
      [[ "$ref" == "$self" || "$ref" == "$(basename "$file" .md)" ]] && continue
      deps+=("\`${ref}\` skill")
    fi
  done
  local IFS=', '
  printf '%s' "${deps[*]}"
}

# List optional/suggested skill references (not hard dependencies).
works_with() {
  local file="$1" deps=() required
  required="$(requires "$file")"
  local ref
  for ref in $(grep -oP '`[a-z][-a-z0-9]*`' "$file" 2>/dev/null | tr -d '`' | sort -u); do
    if [[ -d "${SKILLS_DIR}/${ref}" ]]; then
      local self
      self="$(basename "$(dirname "$file")")"
      [[ "$ref" == "$self" || "$ref" == "$(basename "$file" .md)" ]] && continue
      # Skip if already listed as a hard dependency
      echo "$required" | grep -q "\`${ref}\`" && continue
      deps+=("\`${ref}\` skill")
    fi
  done
  local IFS=', '
  printf '%s' "${deps[*]}"
}

# Extract the @file description from a plugin's JSDoc block.
plugin_desc() {
  awk '
    /^\/\*\*/ { jd=1; next }
    jd && /\*\// { exit }
    jd && /@file / { sub(/.*@file /, ""); sub(/\.? *$/, ""); print; exit }
  ' "$1"
}

# ---------------------------------------------------------------------------
# Generate README.md
# ---------------------------------------------------------------------------
generate_readme() {
  {
    cat <<EOF
# OpenCode Config

Shared [OpenCode](https://opencode.ai) skills, agents, plugins, and commands.

Generated and published from [\`${DOTFILES_REPO}\`](${DOTFILES_URL}), with shared skills sourced from [\`${SKILLS_REPO}\`](${SKILLS_URL}).

See the [OpenCode overview](https://dotfiles.timmo.dev/agents/opencode/overview/) for the overview, MCP notes, and generated reference pages.

## Installation

Clone the repo and copy what you need into your OpenCode config directory:

\`\`\`bash
git clone https://github.com/${PUBLISH_REPO}.git
cd opencode-config

# Copy individual items
cp -r skills/diagnose ~/.agents/skills/
cp commands/inject-context.md ~/.config/opencode/commands/
cp plugins/env-protection.ts ~/.config/opencode/plugins/
cp -r lib ~/.config/opencode/
cp agents/reviewer.md ~/.config/opencode/agents/

# Or copy everything
cp -r skills ~/.agents/
cp -r agents commands plugins lib ~/.config/opencode/
\`\`\`

> **Stow users:** If your OpenCode config is managed by [GNU Stow](https://www.gnu.org/software/stow/) or a similar symlink manager, the \`cp\` commands above will not work — they copy into the live path rather than your stow source directory. Either follow the [dotfiles setup](${DOTFILES_URL}) this repo is published from, or ask an agent to adapt the files into your own stow structure.

Some skills and commands depend on plugins to function. Check the tables below for required plugins and install them alongside the skill or command.

### Importing Skills

Once you have the \`import-external-skill\` skill installed, you can use it to import skills from this or any public GitHub skills repo. Point it at a skill directory URL and it handles fetching, frontmatter conversion, and origin tracking:

\`\`\`
# origin: https://github.com/${SKILLS_REPO}/tree/main/<skill-name>
\`\`\`

It also supports a review mode: give it a repo URL and it will list all available skills, compare them against your local library, and recommend which to import, adapt, or skip.

Agents, commands, and plugins are not managed by \`import-external-skill\` — copy them manually as shown above.

### Minimum Configuration

This repo provides skills, agents, commands, and plugins but not an \`opencode.json\` config file. You need one to load them. Here is a minimal starting point:

\`\`\`jsonc
{
  "\$schema": "https://opencode.ai/config.json",
  // Choose your provider and model
  "model": "anthropic/claude-sonnet-4-20250514",
  // Agents defined in agents/ are loaded automatically from ~/.config/opencode/agents/
  // MCP servers, tool overrides, and provider options go here as needed
}
\`\`\`

Place it at \`~/.config/opencode/opencode.json\` (or \`opencode.jsonc\` for comments). See the [OpenCode docs](https://opencode.ai/docs/config) for the full configuration reference.

## How It Fits Together

The config is built around a few patterns:

- **Branch context injection** — The \`branch-context\` plugin pre-computes git and PR state once per command and injects it as structured XML. Commands that need current-branch context declare a dependency on this plugin instead of running their own \`git\`/\`gh\` calls.
- **Graduated agent permissions** — Agents range from workspace-read-only (\`reviewer\`, \`ask\`) through ask-gated (\`build-ask\`) to edit-capable (\`refactorer\`). Read-only primary agents use native task allowlists, while terminal read-only subagents cannot delegate further.
- **Scoped cleanup commands** — Commands like \`/refactor-enforce-types\`, \`/refactor-cleanup-variables\`, and \`/refactor-remove-single-use\` combine branch-context work-scope with a matching skill and route through the \`refactorer\` agent, keeping changes within the current git diff.
- **Skill-based routing** — Commands are thin wrappers that name an agent, declare required skills, and state whether branch context is needed. The workflow logic lives in skills and plugins, not in the command itself.
- **Secret protection** — The \`env-protection\` plugin blocks reads of \`.env\` files (except \`.env.example\`) across all agents.

## Skills

| Skill | Description | Requires | Works with |
|---|---|---|---|
EOF

    for skill_dir in "${SKILLS_DIR}"/*/; do
      [[ -f "${skill_dir}SKILL.md" ]] || continue
      local o
      o="$(origin "${skill_dir}SKILL.md")"
      [[ -n "$o" ]] && continue
      local name desc deps optional
      name="$(basename "$skill_dir")"
      desc="$(field "${skill_dir}SKILL.md" description)"
      deps="$(requires "${skill_dir}SKILL.md")"
      optional="$(works_with "${skill_dir}SKILL.md")"
      printf '| `%s` | %s | %s | %s |\n' "$name" "$desc" "$deps" "$optional"
    done | sort

    cat <<'EOF'

### From External Sources

These skills were imported from other repos. Some are used as-is; others have been adapted for local workflows and conventions.

| Skill | Origin | Local Changes | Requires | Works with |
|---|---|---|---|---|
EOF

    for skill_dir in "${SKILLS_DIR}"/*/; do
      [[ -f "${skill_dir}SKILL.md" ]] || continue
      local o
      o="$(origin "${skill_dir}SKILL.md")"
      [[ -z "$o" ]] && continue
      local name deps optional origin_label adapted="No"
      name="$(basename "$skill_dir")"
      deps="$(requires "${skill_dir}SKILL.md")"
      optional="$(works_with "${skill_dir}SKILL.md")"
      origin_label="$(printf '%s' "$o" | sed -n 's|https://github.com/\([^/]*/[^/]*\)/.*|\1|p')"
      grep -q '^# local-edits:' "${skill_dir}SKILL.md" 2>/dev/null && adapted="Yes"
      printf '| `%s` | [%s](%s) | %s | %s | %s |\n' "$name" "${origin_label:-$o}" "$o" "$adapted" "$deps" "$optional"
    done | sort

    printf '\n## Agents\n\n'
    printf '| Agent | Description |\n|---|---|\n'

    for agent_file in "${CONFIG_DIR}/agents"/*.md; do
      [[ -f "$agent_file" ]] || continue
      local name desc
      name="$(basename "$agent_file" .md)"
      desc="$(field "$agent_file" description)"
      printf '| `%s` | %s |\n' "$name" "$desc"
    done | sort

    printf '\n## Commands\n\n'
    printf '| Command | Description | Agent | Requires | Works with |\n|---|---|---|---|---|\n'

    while IFS= read -r cmd_file; do
      [[ -f "$cmd_file" ]] || continue
      local rel_path name dir_part desc agent deps optional
      rel_path="${cmd_file#"${CONFIG_DIR}/commands/"}"
      name="$(basename "$rel_path" .md)"
      dir_part="${rel_path%/*}"
      [[ "$dir_part" != "$(basename "$rel_path")" ]] && name="${dir_part}/${name}"
      desc="$(field "$cmd_file" description)"
      agent="$(field "$cmd_file" agent)"
      deps="$(requires "$cmd_file")"
      optional="$(works_with "$cmd_file")"
      printf '| `/%s` | %s | %s | %s | %s |\n' "$name" "$desc" "${agent:-default}" "$deps" "$optional"
    done < <(find "${CONFIG_DIR}/commands" -name '*.md' -type f | sort)

    printf '\n## Plugins\n\n'
    printf '| Plugin | Description |\n|---|---|\n'

    for plugin_file in "${CONFIG_DIR}/plugins"/*.ts; do
      [[ -f "$plugin_file" ]] || continue
      local name desc
      name="$(basename "$plugin_file" .ts)"
      desc="$(plugin_desc "$plugin_file")"
      printf '| `%s` | %s |\n' "$name" "$desc"
    done | sort

    cat <<EOF

## Publishing

This repo is published automatically via GitHub Actions when the OpenCode config
[\`${OPENCODE_SOURCE_PREFIX}/\`](${OPENCODE_SOURCE_URL}) or the pinned
[\`${SKILLS_REPO}\`](${SKILLS_URL}) revision changes.
EOF
  } >"${OUTPUT_DIR}/README.md"
}

# ---------------------------------------------------------------------------
# Generate AGENTS.md
# ---------------------------------------------------------------------------
generate_agents() {
  cat <<EOF >"${OUTPUT_DIR}/AGENTS.md"
# AGENTS

Instructions for coding agents working in this repository.

## Source

This repo is generated from the OpenCode configuration in [\`${DOTFILES_REPO}\`](${DOTFILES_URL}).

OpenCode config source: [\`${OPENCODE_SOURCE_PREFIX}/\`](${OPENCODE_SOURCE_URL})

Shared skills source: [\`${SKILLS_REPO}\`](${SKILLS_URL})

Do not edit generated files here directly. Make OpenCode config changes in [\`${DOTFILES_REPO}\`](${DOTFILES_URL}) and skill changes in [\`${SKILLS_REPO}\`](${SKILLS_URL}).

## Structure

\`\`\`
skills/      OpenCode skills (SKILL.md per directory, optional references/)
agents/      Agent definitions (YAML frontmatter + Markdown body)
commands/    Slash commands (YAML frontmatter + Markdown workflow)
plugins/     Lifecycle plugins (ESM TypeScript)
lib/         Shared modules imported by plugins
\`\`\`

## Skills

Each skill is a directory containing a \`SKILL.md\` with YAML frontmatter (\`name\`, \`description\`) and a Markdown body with checklists and guidance. Some skills include a \`references/\` subdirectory with supporting documents.

Imported skills include \`# origin:\` and \`# upstream-sha:\` comments in their frontmatter for tracking upstream changes.

## Importing

To import a skill into your own OpenCode setup, use the \`import-external-skill\` workflow with a GitHub tree URL pointing at the skill directory:

\`\`\`
https://github.com/${SKILLS_REPO}/tree/main/<skill-name>
\`\`\`

Agents, commands, and plugins can be copied directly into your OpenCode config directory.
EOF
}

# ---------------------------------------------------------------------------
# Sync to publish repo
# ---------------------------------------------------------------------------
validate_plugin_imports() {
  local config_dir="$1"
  local plugin_file import_path resolved

  while IFS= read -r plugin_file; do
    while IFS= read -r import_path; do
      [[ -n "$import_path" ]] || continue
      resolved="$(dirname "$plugin_file")/$import_path"
      if [[ -f "$resolved" || -f "${resolved}.ts" || -f "${resolved}.js" || -f "${resolved%.js}.ts" || -f "${resolved}/index.ts" || -f "${resolved}/index.js" ]]; then
        continue
      fi

      echo "::error::Plugin import is missing: ${plugin_file#"${config_dir}/"} -> ${import_path}"
      return 1
    done < <(
      sed -nE \
        -e "s/.*from[[:space:]]+['\"](\.\.?\/[^'\"]+)['\"].*/\1/p" \
        -e "s/^[[:space:]]*import[[:space:]]+['\"](\.\.?\/[^'\"]+)['\"].*/\1/p" \
        -e "s/.*import[[:space:]]*\([[:space:]]*['\"](\.\.?\/[^'\"]+)['\"].*/\1/p" \
        "$plugin_file"
    )
  done < <(find "${config_dir}/plugins" -type f \( -name '*.ts' -o -name '*.js' \) -print)
}

sync_to_publish() {
  echo "::group::Sync files to publish repo"

  [[ -d "${CONFIG_DIR}" ]] || {
    echo "::error::OpenCode config source not found: ${CONFIG_DIR}"
    return 1
  }
  [[ -d "${SKILLS_DIR}" ]] || {
    echo "::error::Shared skills source not found: ${SKILLS_DIR}"
    return 1
  }
  [[ -d "${CONFIG_DIR}/lib" ]] || {
    echo "::error::OpenCode shared modules not found: ${CONFIG_DIR}/lib"
    return 1
  }
  [[ -d "${PUBLISH_DIR}/.git" ]] || {
    echo "::error::Publish directory is not a Git checkout: ${PUBLISH_DIR}"
    return 1
  }

  validate_plugin_imports "${CONFIG_DIR}"

  # Clean generated targets while preserving the existing skills submodule.
  find "${PUBLISH_DIR}" -mindepth 1 -maxdepth 1 \
    ! -name '.git' ! -name '.gitmodules' ! -name 'skills' -exec rm -rf {} +

  # Copy OpenCode config directories from their stow source.
  for dir in agents commands plugins lib; do
    [[ -d "${CONFIG_DIR}/${dir}" ]] || continue
    cp -a "${CONFIG_DIR}/${dir}" "${PUBLISH_DIR}/"
  done

  # Keep skills as a pinned reference to their independent source repository.
  if [[ ! -d "${PUBLISH_DIR}/skills/.git" && ! -f "${PUBLISH_DIR}/skills/.git" ]]; then
    git -C "${PUBLISH_DIR}" submodule add --force "${SKILLS_URL}.git" skills
  fi
  local skills_sha
  skills_sha="$(git -C "${SKILLS_DIR}" rev-parse HEAD)"
  git -C "${PUBLISH_DIR}/skills" fetch --depth=1 origin "${skills_sha}"
  git -C "${PUBLISH_DIR}/skills" checkout "${skills_sha}"

  echo "::endgroup::"
}

# ---------------------------------------------------------------------------
# Commit and push
# ---------------------------------------------------------------------------
commit_and_push() {
  cd "${PUBLISH_DIR}"

  git add -A
  if git diff --cached --quiet; then
    echo "No changes to publish"
    return 0
  fi

  if [[ "${PUBLISH_DRY_RUN:-}" == "1" ]]; then
    echo "Dry run enabled; skipping commit and push"
    git diff --cached --stat
    return 0
  fi

  local short_sha
  short_sha="$(git -C "${GITHUB_WORKSPACE}" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

  git commit -m "publish: sync from ${DOTFILES_REPO}@${short_sha}"
  git push
  echo "Published to https://github.com/${PUBLISH_REPO}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  sync_to_publish

  echo "::group::Generate docs"
  OUTPUT_DIR="${PUBLISH_DIR}"
  generate_readme
  generate_agents
  echo "Generated README.md and AGENTS.md in publish repo"
  echo "::endgroup::"

  commit_and_push
}

main "$@"
