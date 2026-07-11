---
title: Private Packages
description: Build and publish Arch packages to the private pacman repo.
sidebar:
  order: 5
---

`dot` can build and publish mapped private packages into a private pacman repository, and register the repo include in `pacman.conf`.

## Public packages

`dot init` and a full unscoped `dot update` install the Arch and AUR packages listed in `.dot-public-packages` at the repo root. The file is one package name per line; blank lines and `#` comments are ignored.

The list covers shared tooling rather than desktop apps you might install separately: build helpers (`cmake`, `gcc`, `pkgconf`), diagnostics (`bmon`, `iperf3`, `sysstat`, `topgrade-bin`), shell and terminal helpers (`zsh` and its plugins, `mise-bin`, `yazi`), desktop integrations (`context-git`, `repo-notes-git`, `kdeconnect`, `system-bridge-git`), and other utilities referenced across the dotfiles setup. Override the path with `DOT_PUBLIC_PACKAGES_FILE`.

Missing public packages are installed with `omarchy-pkg-aur-add`; already-installed packages are left in place. `dot doctor` checks the public and private package lists after setup.

Some AUR packages conflict with an official-repo package that must be removed first. `dot` handles the known case (`mise-bin` replacing `mise`) before installing.

Private packages from `.dot-private-packages` in the private overlay are installed after the public list during init when the overlay is available.

## Register the private repo

```bash
dot setup-private-repo
```

Syncs the private Arch package repo mirror, writes the private pacman repo snippet, and adds the `Include` line to `/etc/pacman.conf` when it is missing. If the local source clone is missing, setup skips cloning only when the configured mirror already contains `<repo>.db`, `<repo>.db.tar.gz`, or `<repo>.db.tar.zst` and pacman registration is current. This supports an already usable local mirror, but publishing still requires the configured source clone to exist. The command repairs Omarchy `pacman.conf` refreshes that remove local repository includes. Privileged writes prefer `pkexec` and fall back to `sudo`.

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
