---
title: Private Packages
description: Build and publish Arch packages to the private pacman repo.
---

`dot` can build and publish mapped private packages into a private pacman repository, and register the repo include in `pacman.conf`.

## Register the private repo

```bash
dot setup-private-repo
```

Syncs the private Arch package repo mirror, writes the private pacman repo snippet, and adds the `Include` line to `/etc/pacman.conf` when it is missing. This repairs Omarchy `pacman.conf` refreshes that remove local repository includes. Privileged writes prefer `pkexec` and fall back to `sudo`.

## Publish a package

```bash
dot private-pkg-publish <package-name>
dot private-pkg-publish <package-name> --install
dot private-pkg-publish --skip-build --no-git <package-name>
```

Builds and publishes a mapped private package into the private pacman repo, syncs the mirror, refreshes pacman metadata, optionally installs it, and commits/pushes by default.

| Flag | Effect |
| --- | --- |
| `--no-git` | Skip the package repo commit and push. |
| `--skip-build` | Publish an existing dist package artifact. |
| `--install` | Install the published package after syncing the mirror. |

## Configuration

Package lists, the repo map, and pacman paths are overridable with environment variables:

- `DOT_PUBLIC_PACKAGES_FILE` — public Arch/AUR package list (default `$DOTFILES_PUBLIC_DIR/.dot-public-packages`).
- `DOT_PRIVATE_PACKAGE_REPO_FILE` — private pacman repo config (default `$DOTFILES_PRIVATE_DIR/.dot-private-package-repo`).
- `DOT_PRIVATE_PACKAGES_FILE` — private package list (default `$DOTFILES_PRIVATE_DIR/.dot-private-packages`).
- `DOT_PRIVATE_PACKAGE_MAP_FILE` — package name-to-source map for `dot private-pkg-publish` (default `$DOTFILES_PRIVATE_DIR/.dot-private-package-map`).
- `DOT_PRIVATE_PACMAN_REPO_CONFIG` — pacman repo snippet path written by `dot` (default `/etc/pacman.d/timmo-private.conf`).
- `DOT_PRIVATE_PACMAN_MAIN_CONFIG` — main pacman config scanned for the private repo `Include` (default `/etc/pacman.conf`).

See [Environment Variables](/configuration/environment/) for the full list.
