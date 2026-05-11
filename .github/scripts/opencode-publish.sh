#!/usr/bin/env bash
# Generates README.md and AGENTS.md from the live opencode config, then
# syncs the subtree contents into the target publish repo and pushes.
#
# Expected environment:
#   DOTFILES_REPO   - owner/repo of the dotfiles source (e.g. timmo001/dotfiles)
#   PUBLISH_REPO    - owner/repo of the target publish repo (e.g. timmo001/opencode-config)
#   SOURCE_PREFIX   - subtree path within dotfiles (e.g. agents/.config/opencode)
#   SOURCE_BRANCH - branch name in dotfiles repo (e.g. distro/arch-omarchy)
#   PUBLISH_DIR     - local checkout of the publish repo
set -euo pipefail

CONFIG_DIR="${SOURCE_PREFIX}"
DOTFILES_URL="https://github.com/${DOTFILES_REPO}"
SOURCE_URL="${DOTFILES_URL}/tree/${SOURCE_BRANCH}/${SOURCE_PREFIX}"

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
  local ref
  for ref in $(grep -P '[Ll]oad\b.*`[a-z][-a-z0-9]*`' "$file" 2>/dev/null \
    | grep -oP '`[a-z][-a-z0-9]*`' | tr -d '`' | sort -u); do
    if [[ -d "${CONFIG_DIR}/skills/${ref}" ]]; then
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
    if [[ -d "${CONFIG_DIR}/skills/${ref}" ]]; then
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

Published from [\`${DOTFILES_REPO}\`](${DOTFILES_URL}) — source at [\`${SOURCE_PREFIX}/\`](${SOURCE_URL}).

## Installation

Clone the repo and copy what you need into your OpenCode config directory:

\`\`\`bash
git clone https://github.com/${PUBLISH_REPO}.git
cd opencode-config

# Copy individual items
cp -r skills/diagnose ~/.config/opencode/skills/
cp commands/git-workflow.md ~/.config/opencode/commands/
cp plugins/env-protection.js ~/.config/opencode/plugins/
cp agents/reviewer.md ~/.config/opencode/agents/

# Or copy everything
cp -r skills agents commands plugins ~/.config/opencode/
\`\`\`

> **Stow users:** If your OpenCode config is managed by [GNU Stow](https://www.gnu.org/software/stow/) or a similar symlink manager, the \`cp\` commands above will not work — they copy into the live path rather than your stow source directory. Either follow the [dotfiles setup](${DOTFILES_URL}) this repo is published from, or ask an agent to adapt the files into your own stow structure.

Some skills and commands depend on plugins to function. Check the tables below for required plugins and install them alongside the skill or command.

### Importing Skills

Once you have the \`import-external-skill\` skill installed, you can use it to import skills from this or any public GitHub skills repo. Point it at a skill directory URL and it handles fetching, frontmatter conversion, and origin tracking:

\`\`\`
# origin: https://github.com/${PUBLISH_REPO}/tree/main/skills/<skill-name>
\`\`\`

It also supports a review mode: give it a repo URL and it will list all available skills, compare them against your local library, and recommend which to import, adapt, or skip.

Agents, commands, and plugins are not managed by \`import-external-skill\` — copy them manually as shown above.

## How It Fits Together

The config is built around a few patterns:

- **Branch context injection** — The \`branch-context\` plugin pre-computes git and PR state once per command and injects it as structured XML. Commands that need current-branch context declare a dependency on this plugin instead of running their own \`git\`/\`gh\` calls.
- **Graduated agent permissions** — Agents range from fully read-only (\`reviewer\`, \`ask\`) through ask-gated (\`build-ask\`) to edit-capable (\`refactorer\`, \`build-locked\`). A guard plugin prevents read-only agents from escalating via subagent delegation.
- **Scoped cleanup commands** — Commands like \`/types-enforce-ts\`, \`/cleanup-unnecessary-variables\`, and \`/remove-single-use-functions\` combine branch-context work-scope with a matching skill and route through the \`refactorer\` agent, keeping changes within the current git diff.
- **Skill-based routing** — Commands are thin wrappers that name an agent, declare required skills, and state whether branch context is needed. The workflow logic lives in skills and plugins, not in the command itself.
- **Secret protection** — The \`env-protection\` plugin blocks reads of \`.env\` files (except \`.env.example\`) across all agents.

## Skills

| Skill | Description | Requires | Works with |
|---|---|---|---|
EOF

    for skill_dir in "${CONFIG_DIR}/skills"/*/; do
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

    for skill_dir in "${CONFIG_DIR}/skills"/*/; do
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

    for plugin_file in "${CONFIG_DIR}/plugins"/*.js; do
      [[ -f "$plugin_file" ]] || continue
      local name desc
      name="$(basename "$plugin_file" .js)"
      desc="$(plugin_desc "$plugin_file")"
      printf '| `%s` | %s |\n' "$name" "$desc"
    done | sort

    cat <<EOF

## Publishing

This repo is published automatically via GitHub Actions when the source
[\`${SOURCE_PREFIX}/\`](${SOURCE_URL}) changes.
EOF
  } > "${CONFIG_DIR}/README.md"
}

# ---------------------------------------------------------------------------
# Generate AGENTS.md
# ---------------------------------------------------------------------------
generate_agents() {
  cat <<EOF > "${CONFIG_DIR}/AGENTS.md"
# AGENTS

Instructions for coding agents working in this repository.

## Source

This repo is a published snapshot of OpenCode configuration from [\`${DOTFILES_REPO}\`](${DOTFILES_URL}).

Source files: [\`${SOURCE_PREFIX}/\`](${SOURCE_URL})

Do not edit files here directly. Make changes in the [source dotfiles repo](${DOTFILES_URL}) and push — a GitHub Actions workflow publishes automatically.

## Structure

\`\`\`
skills/      OpenCode skills (SKILL.md per directory, optional references/)
agents/      Agent definitions (YAML frontmatter + Markdown body)
commands/    Slash commands (YAML frontmatter + Markdown workflow)
plugins/     Lifecycle plugins (ESM JavaScript)
\`\`\`

## Skills

Each skill is a directory containing a \`SKILL.md\` with YAML frontmatter (\`name\`, \`description\`) and a Markdown body with checklists and guidance. Some skills include a \`references/\` subdirectory with supporting documents.

Imported skills include \`# origin:\` and \`# upstream-sha:\` comments in their frontmatter for tracking upstream changes.

## Importing

To import a skill into your own OpenCode setup, use the \`import-external-skill\` workflow with a GitHub tree URL pointing at the skill directory:

\`\`\`
https://github.com/${PUBLISH_REPO}/tree/main/skills/<skill-name>
\`\`\`

Agents, commands, and plugins can be copied directly into your OpenCode config directory.
EOF
}

# ---------------------------------------------------------------------------
# Sync to publish repo
# ---------------------------------------------------------------------------
sync_to_publish() {
  echo "::group::Sync files to publish repo"

  # Clean target (preserve .git)
  find "${PUBLISH_DIR}" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

  # Copy subtree contents
  cp -a "${CONFIG_DIR}/." "${PUBLISH_DIR}/"

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
  echo "::group::Generate docs"
  generate_readme
  generate_agents
  echo "Generated README.md and AGENTS.md"
  echo "::endgroup::"

  sync_to_publish
  commit_and_push
}

main "$@"
