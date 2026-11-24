---
name: dot-stow
description: >
  Edit stow source paths rather than live files, and apply them with the dot
  command. Use when changing configs managed by ~/.config/dotfiles or
  ~/.config/dotfiles-private.
metadata:
  author: timmo001
---

# Dotfiles Stow Skill

Use this skill for changes to user config managed by GNU Stow through the public `~/.config/dotfiles` source or optional private `~/.config/dotfiles-private` overlay.

## Rules

1. Resolve every live config path to its owning stow source before editing.
2. Edit the source repository, never an unmanaged live file.
3. Run `dot stow` after stowed source changes (the `dot` Code Mode `stow` tool, or the command).
4. Review third-party skill updates through `dot skills updates`; `dot up skills` links the latest pushed `main`.
5. Push skills changes to `main` before expecting them locally, then run `dot up skills` yourself: it fetches the managed checkout and relinks, headless; there is no submodule pin to advance.
6. When renaming or removing a skill, update the command wrappers (such as `/commit`) that load it.
7. After OpenCode config changes, run the relevant `opencode2 debug` checks (`config`, `paths`, `agents`).

## Common Paths

- `~/.zshrc` -> `~/.config/dotfiles/zsh/.zshrc`
- `~/.config/nvim/init.lua` -> `~/.config/dotfiles/neovim/.config/nvim/init.lua`
- `~/.agents/skills/dot-stow` -> `~/.config/dotfiles/dotfiles-skills/.agents/skills/dot-stow`
- Shared adapted skills -> `~/repos/skills/<name>`
- Reviewed third-party snapshots -> `~/repos/skills/<name>` plus its `skills.yml` entry

Do not run `dot clean` unless the user explicitly asks to remove stowed configuration.

## Omarchy Host Overrides

- Hyprland config is stowed from `hypr/.config/hypr/`, with host overrides selected through `~/.config/hypr/host`.
- The Hypr package is stowed non-destructively: `dot stow` and `dot install` never unstow it first, so `hyprland.lua` cannot disappear during Hyprland's live reload.
- Keep the generated Omarchy `shell.json`, Lua host layout, and canonical docs in sync when their contracts change.
