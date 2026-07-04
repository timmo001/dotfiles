---
name: dotfiles-stow
description: >
  REQUIRED when changing configs managed by ~/.config/dotfiles or
  ~/.config/dotfiles-private. Enforces editing stow source paths (not ad-hoc
  live paths) and using the dot command for stow/update/validation workflows.
---

# Dotfiles Stow Skill

Use this skill for changes to user config that is managed by GNU Stow through:

- `~/.config/dotfiles` (public/shared)
- `~/.config/dotfiles-private` (private overlay)

## When This Skill MUST Be Used

Always invoke this skill when a task involves any of the following:

- Editing files that belong to stowed dotfiles managed by `dot`
- Requests that reference `~/.config/dotfiles` or `~/.config/dotfiles-private`
- Requests to edit live config under `~/.config/*`, `~/.zshrc`, `~/.zshrc-private`, `~/.cursor/*`, or `~/.claude/*` where the file is stow-managed
- Running install/update/stow/doctor workflows for dotfiles

If a path is stow-managed, edit the repository source path instead of making ad-hoc live-file changes.

## Source of Truth and Overlay Rules

1. Public source of truth: `~/.config/dotfiles`
2. Private source of truth: `~/.config/dotfiles-private`
3. Private overlay wins on conflicts because `dot` stows public first, then private.
4. Keep shared, non-sensitive config in public; keep secrets/personal machine details in private.

Do not edit files directly in non-repo locations when the file should be represented by a stow package.

## Correct Stowed Areas

Map live paths to stow package paths before editing.

Examples:

- `~/.zshrc` -> `~/.config/dotfiles/zsh/.zshrc`
- `~/.zshrc-private` -> `~/.config/dotfiles-private/zsh/.zshrc-private`
- `~/.config/nvim/init.lua` -> `~/.config/dotfiles/neovim/.config/nvim/init.lua`
- `~/.config/starship.toml` -> `~/.config/dotfiles/starship/.config/starship.toml`
- `~/.agents/skills/*` -> `~/.config/dotfiles/agents/.agents/skills/*` (or private `agents/.agents/skills/*` when intentionally private)
- `~/.cursor/rules/*` -> `~/.config/dotfiles-private/agents/.cursor/rules/*`

If unsure where a managed file belongs:

1. Check both repos for an existing stow package path.
2. Prefer updating the existing owner location.
3. If creating a new managed file, place it under the appropriate package in public or private repo based on sensitivity.

## Dot Command and When It Should Run

Use `dot` as the canonical workflow command instead of raw `stow` for normal operations.

- `dot stow` - run after local edits to stowed files to re-apply links without pulling repos.
- `dot update` - run when you need latest repo changes plus re-stow (`pull + stow` workflow).
- `dot git-diff` - run to review current repo status across managed repos (`dot diff` is a human compatibility alias).
- `dot doctor` - run to verify tool/repo health when setup issues are suspected.
- `dot init` - run for first-time setup on a machine.
- `dot install` - run for backup/adopt install flow.
- `dot agents-sync` - run when AGENTS mirroring is specifically needed (also runs automatically in `dot update`/`dot git-diff` by default).

## Safety Rules

- Do not run `dot clean` unless the user explicitly asks for unstow/removal behavior.
- Do not bypass `dot` with direct `stow` commands unless debugging a `dot` issue.
- Preserve existing unrelated changes in dirty worktrees.
- If private repo access is unavailable, continue with public-safe steps and clearly report what private actions were skipped.

## Documentation Sync Rules

When editing the public dotfiles repo (`~/.config/dotfiles`), treat a docs update as part of the change, not a follow-up:

- The Astro + Starlight site under `docs/` is the canonical human documentation. Any change to documented behaviour (commands, flags, workflows, paths, config, stow packages, or user-facing scripts) must update the relevant page under `docs/src/content/docs/` in the same commit.
- New stow packages and user-facing scripts (for example a `topgrade/` package or a `scripts/.local/bin/*` tool) are not generated. Add or extend a hand-written page under `configuration/`, `dot/`, `omarchy/`, or `getting-started/`.
- `docs/src/content/docs/dot/commands.md` and `docs/src/content/docs/reference/{agents,commands,skills,plugins}.md` are generated. Edit their sources (`dot/src/cli/spec.ts` and the OpenCode assets under `agents/**`), then run `mise run docs:gen` and commit the result; the `dot` reference also pairs with `dot completions`.
- The `docs-drift` CI workflow fails a pull request when a fresh `mise run docs:gen` would change those generated pages, so regenerate and commit before opening a PR.
- See the repo `AGENTS.md` "Documentation Site" section for the full source-to-page mapping.

## Omarchy Host Override Documentation Rules

- Hyprland config is a stowed dotfiles package (`hypr/.config/hypr/`, conf-only), not a tracked Omarchy repo.
- `waybar`, `ghostty`, and `uwsm` are single-branch Omarchy repos expected on `main`.
- `bootstrap` is expected on `distro/omarchy`.
- Hypr host-specific overrides live under `~/.config/hypr/hosts/$OMARCHY_HOST`, selected by the runtime `~/.config/hypr/host` symlink.
- `dot stow` lays down the Hypr package with `--no-folding` and creates/repairs `~/.config/hypr/host`; `dot doctor` checks it and flags any leftover legacy `omarchy-hypr` clone.
- When changing host override layout or guidance, update the relevant `README.md`, `AGENTS.md`, and skill documentation together.
- Repos that use host-specific overrides should have their own `README.md` and `AGENTS.md` that explicitly state the arrangement and the requirement to keep related documentation in sync when it changes.

## Suggested Execution Flow

1. Identify the live target path from the request.
2. Resolve it to the correct stow source path in public/private repo.
3. Edit only source files under `~/.config/dotfiles*`.
4. Run `dot stow` for relinking after edits.
5. Run targeted validation (for example `bash -n scripts/.local/bin/dot` when editing the `dot` script).
6. Report what changed, what was verified, and any remaining manual follow-up.
