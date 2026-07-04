# HYPR AGENTS

Instructions for coding agents working in the Hyprland config package.

## Host Override Layout

- This config is stowed from the dotfiles repo as the `hypr` package, with host-specific overrides.
- Shared entry files live at the package root.
- Host overrides live under `hosts/desktop/` and `hosts/laptop/`.
- `dot stow` creates `~/.config/hypr/host` as a symlink to `hosts/$OMARCHY_HOST`.
- This package is stowed non-destructively: `dot stow` and `dot install` skip the usual unstow-then-restow for `hypr` (its symlinks, notably `hyprland.lua`, never vanish mid-stow) and reload Hyprland afterwards, so Hyprland's live-config autoreload never trips into emergency mode. Preserve this if you edit the stow loop in `dot/src/commands/{Stow,Install}.ts`.

## Documentation Sync

- If this host override arrangement changes, update this package's `README.md` and `AGENTS.md` plus the related documentation and skill guidance in `~/.config/dotfiles` together.
- Keep host-specific instructions accurate for both laptop and desktop overrides.
