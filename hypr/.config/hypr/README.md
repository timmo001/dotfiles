# Omarchy Hyprland Config

My Hyprland Config for [omarchy](https://omarchy.org), stowed from my [dotfiles](https://github.com/timmo001/dotfiles/tree/distro/arch-omarchy) as the `hypr` package.

This config uses Lua entry files with host-specific overrides.

- Shared entry files live at the package root (`hypr/.config/hypr/`).
- Host overrides live under `hosts/desktop/` and `hosts/laptop/`.
- `dot stow` lays down the package with `--no-folding` and creates `~/.config/hypr/host` as a symlink to `hosts/$OMARCHY_HOST`.
- This package is stowed non-destructively: `dot stow` and `dot install` skip the usual unstow-then-restow for `hypr` so its symlinks (notably `hyprland.lua`) never disappear mid-stow, then reload Hyprland afterwards. This keeps Hyprland's live-config autoreload from catching a missing config and dropping into emergency mode.

If this host override arrangement changes, update this `README.md`, this package's `AGENTS.md`, and the related documentation and skill guidance in `~/.config/dotfiles` together.
