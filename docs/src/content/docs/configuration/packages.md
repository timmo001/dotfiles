---
title: Packages
description: Install packages from the signed public repository, AUR, and private repository.
sidebar:
  order: 5
---

`dot` configures the signed public `timmo` repository, keeps AUR available as a source-build fallback, and can build and publish mapped private packages into a separate local repository.

## Public repository

`dot init` runs `dot setup-public-repo` before resolving public packages. The setup downloads the public key from `packages.timmo.dev`, requires the pinned full fingerprint `F94469C08E3B717014E2815FA026A3671E9151DA`, locally signs it in pacman's keyring, and registers this snippet before the other package repositories:

```ini
[timmo]
SigLevel = PackageRequired DatabaseOptional TrustedOnly
Server = https://packages.timmo.dev/$arch
```

The repository overlays maintained package names. `omarchy-pkg-aur-add` uses the configured binary repository when a matching package is available and retains AUR resolution for packages or source-build variants not published there. A missing repository database or fingerprint mismatch stops setup before trust or pacman configuration is changed.

## Public packages

`dot init` installs the Arch and AUR packages listed in `.dot-public-packages` at the repo root. The file is one package name per line; blank lines and `#` comments are ignored. Ongoing package health is reported by `dot doctor`; `dot update` does not check or install packages. Its pull phase does resync the configured private repository mirror and refresh pacman metadata when that repository is updated.

The list covers shared tooling rather than desktop apps you might install separately, including build helpers, diagnostics, shell and terminal tools, and desktop integrations. Override the path with `DOT_PUBLIC_PACKAGES_FILE`.

Missing public packages are installed with `omarchy-pkg-aur-add`; already-installed packages are left in place. `dot doctor` checks the public repository trust and configuration plus the public and private package lists after setup.

Some AUR packages conflict with an official-repo package that must be removed first. `dot` handles the known case (`mise-bin` replacing `mise`) before installing.

Private packages from `.dot-private-packages` in the private overlay are installed after the public list during init when the overlay is available. A host-specific `.dot-private-packages--<host>` list is additive, so hardware-specific packages can be limited to hosts such as `desktop`.

## Register the private repo

```bash
dot setup-private-repo
```

Syncs the private Arch package repo mirror, writes the private pacman repo snippet, adds the `Include` line to `/etc/pacman.conf` when it is missing, and refreshes pacman metadata. If the local source clone is missing, setup skips cloning only when the configured mirror already contains `<repo>.db`, `<repo>.db.tar.gz`, or `<repo>.db.tar.zst` and pacman registration is current. This supports an already usable local mirror, but publishing still requires the configured source clone to exist. The command repairs Omarchy `pacman.conf` refreshes that remove local repository includes. Privileged writes prefer `pkexec` and fall back to `sudo`.

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
- `DOT_PUBLIC_PACMAN_REPO_CONFIG` — public pacman repo snippet path written by `dot` (default `/etc/pacman.d/timmo.conf`).
- `DOT_PUBLIC_PACMAN_MAIN_CONFIG` — main pacman config scanned for the public repo include (default `/etc/pacman.conf`).
- `DOT_PRIVATE_PACKAGE_REPO_FILE` — private pacman repo config (default `$DOTFILES_PRIVATE_DIR/.dot-private-package-repo`).
- `DOT_PRIVATE_PACKAGES_FILE` — private package list override (default `$DOTFILES_PRIVATE_DIR/.dot-private-packages` plus `.dot-private-packages--<host>` when present).
- `DOT_PRIVATE_PACKAGE_MAP_FILE` — package name-to-source map for `dot private-pkg-publish` (default `$DOTFILES_PRIVATE_DIR/.dot-private-package-map`).
- `DOT_PRIVATE_PACMAN_REPO_CONFIG` — pacman repo snippet path written by `dot` (default `/etc/pacman.d/timmo-private.conf`).
- `DOT_PRIVATE_PACMAN_MAIN_CONFIG` — main pacman config scanned for the private repo `Include` (default `/etc/pacman.conf`).

See [Environment Variables](/configuration/environment/) for the full list.
