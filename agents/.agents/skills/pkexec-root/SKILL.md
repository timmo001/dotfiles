---
name: pkexec-root
description: >
  Use pkexec first for commands that need root directly or indirectly.
---

Use this skill when a command needs root directly or uses sudo internally.

Prefer `pkexec` first.

### Default Pattern

For `yay`, use:

```bash
yay -S <pkg> --sudo pkexec --sudoflags ""
yay -U "/path/to/package.pkg.tar.zst" --sudo pkexec --sudoflags ""
```

For direct `pacman` commands, use:

```bash
pkexec pacman -S <pkg>
pkexec pacman -U "/path/to/package.pkg.tar.zst"
pkexec pacman -R <pkg>
```

For commands that invoke sudo internally, prefer `pkexec` first when practical.

### Fallback Order

If `pkexec` fails, use the first working alternative below and note which path was used:

1. Retry with the same command and confirm the exact package path/arguments are valid.
2. For `yay`, fall back to:

```bash
yay -S <pkg> --sudo sudo --sudoflags ""
yay -U "/path/to/package.pkg.tar.zst" --sudo sudo --sudoflags ""
```

1. If `yay` itself is the problem and the package is local, install with `pkexec pacman -U ...`.
2. If PolicyKit is unavailable or broken and the user asked you to continue, use `sudo` directly.

Commands covered by this skill include:

- commands that normally run with `sudo`
- tools like `yay` that delegate privileged parts to `sudo`
- `omarchy` commands that perform privileged operations under the hood

Examples of `omarchy-*` command families that may need this treatment include:

- `omarchy-install-*`
- `omarchy-update-*`
- `omarchy-pkg-*`
- `omarchy-reinstall*`
- some `omarchy-refresh-*`
- some `omarchy-setup-*`
- other system-level `omarchy-*` commands that touch packages, services, boot config, or `/etc`

This list is not exhaustive.
