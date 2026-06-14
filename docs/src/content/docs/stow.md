---
title: Stow Workflow
description: How dotfiles packages are applied into your home directory with GNU Stow.
---

The repository is a [GNU Stow](https://www.gnu.org/software/stow/) package root targeting `~/`. Each top-level directory (`zsh`, `neovim`, `starship`, `hypr`, `scripts`, ...) is a stow package whose contents are symlinked into your home directory.

## Always use `dot stow`

Apply packages with `dot stow` (or `dot update`, which refreshes stow). Do **not** run GNU `stow` directly from the repo root: `dot` applies the correct adopt / no-folding flow and the public-then-private ordering.

```bash
dot stow            # stow public + private
dot stow --public   # public only
dot stow --private  # private only
```

## What `dot stow` does

- Lays down public packages first, then the private overlay from `~/.config/dotfiles-private`.
- Stows the Hypr package with `--no-folding` and creates/repairs the `~/.config/hypr/host` symlink for the active host.
- Adopts existing files where needed so a fresh machine does not clobber stock config.

## Ignore rules

`.stowrc` sets the stow target and ignore rules. Files that should never be symlinked into `~/` are ignored there, including top-level docs, the `dot/` source, the `docs/` site, and repo metadata. Keep `.stowrc` ignore rules in sync when adding root-only files.

:::caution
The repo root stows to `~/`. Anything not ignored in `.stowrc` becomes a symlink under your home directory. When adding new root-level files or directories that should not be stowed (such as `docs/`), add a matching `--ignore` rule.
:::

## Health check

`dot doctor` runs a dry-run restow to detect drift, alongside its other checks. Run it after changing stow packages to confirm nothing is broken.
