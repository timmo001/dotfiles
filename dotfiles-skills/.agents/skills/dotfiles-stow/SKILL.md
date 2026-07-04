---
name: dotfiles-stow
description: >
  REQUIRED when changing configs managed by ~/.config/dotfiles or
  ~/.config/dotfiles-private. Enforces editing stow source paths (not ad-hoc
  live paths) and using the dot command for stow/update/validation workflows.
---

# Dotfiles Stow Skill

Use this skill for changes to user config managed by GNU Stow through the public `~/.config/dotfiles` source or optional private `~/.config/dotfiles-private` overlay.

## Rules

1. Resolve every live config path to its owning stow source before editing.
2. Keep shared non-sensitive config public and machine-specific or private data in the private overlay.
3. Edit the source repository, never an unmanaged live file.
4. Run `dot stow` after stowed source changes.
5. Review third-party updates in `~/repos/skills` through `dot skill-updates`; normal `dot update` only stows committed snapshots.
6. Make shared skill changes in `~/repos/skills`, then update the pinned submodule only after that repository revision is committed and pushed.
7. Update the canonical docs site when user-facing behaviour, paths, commands, or configuration change.

## Common Paths

- `~/.zshrc` -> `~/.config/dotfiles/zsh/.zshrc`
- `~/.config/nvim/init.lua` -> `~/.config/dotfiles/neovim/.config/nvim/init.lua`
- `~/.agents/skills/dotfiles-stow` -> `~/.config/dotfiles/dotfiles-skills/.agents/skills/dotfiles-stow`
- Shared adapted skills -> `~/repos/skills/<name>`
- Reviewed third-party snapshots -> `~/repos/skills/<name>` plus `imports.json`

Do not run `dot clean` unless the user explicitly asks to remove stowed configuration. Preserve unrelated worktree changes and continue with public-safe work when the private overlay is unavailable.

## Omarchy Host Overrides

- Hyprland config is stowed from `hypr/.config/hypr/`, with host overrides selected through `~/.config/hypr/host`.
- The Hypr package is stowed non-destructively: `dot stow` and `dot install` never unstow it first, so `hyprland.lua` cannot disappear during Hyprland's live reload.
- Keep the generated Omarchy `shell.json`, Lua host layout, and canonical docs in sync when their contracts change.
