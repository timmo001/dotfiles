---
name: install-tool
description: Install tools, applications, CLIs, runtimes, and packages. Use when an installation request should prefer mise for development tools, then fall back to pacman or yay for system-integrated software.
---

# Install Tool

Use mise first for user-scoped development tools. Use Arch packages for software
that needs system integration.

## Workflow

1. Identify the requested tool, version constraint, expected executable, and
   whether it needs root-owned files, services, drivers, desktop integration, or
   another system-level feature.
2. Check whether the request is already satisfied with `command -v <command>`,
   `mise ls --installed`, and `pacman -Q <package>` as applicable. Do not
   reinstall a suitable existing version.
3. Discover viable sources before choosing:
   - Resolve mise shorthand with `mise registry <tool>`.
   - Consider explicit mise backends such as `aqua:owner/repo`,
     `github:owner/repo`, `npm:package`, and `cargo:crate`.
   - Check official Arch repositories and the AUR when mise is unsuitable.
4. Decide whether the installation should persist through dotfiles:
   - The global mise config at `~/.config/mise/config.toml` is stowed from
     `~/.config/dotfiles/mise/.config/mise/config.toml`. Confirm that ownership
     before changing it, and edit the stowed source rather than creating an
     unmanaged live config.
   - Arch packages needed on every public machine belong in
     `~/.config/dotfiles/.dot-public-packages`.
   - Private or machine-specific required packages may belong in the optional
     `~/.config/dotfiles-private/.dot-private-packages` overlay. Do not copy its
     contents into public files or output.
   - `dot init` installs the stowed mise tools, then the public and available
     private package lists. A full unscoped `dot update` installs missing public
     packages. Prefer these managed flows over a one-off package command when
     the tool should remain managed.
5. When multiple viable sources exist, use the question tool to show the
   concrete choices and recommend one. Recommend mise by default. Recommend an
   Arch package for desktop applications, system services, drivers, and tools
   that genuinely need system integration.
6. Install from the selected source:
   - Managed mise: update the stowed global mise source, then run `mise install`
     or the appropriate `dot` flow. `mise use --global <tool>@latest` is valid
     when the global config resolves to that stowed source.
   - Unmanaged mise: `mise use --global <tool>@latest`, or use the requested
     version constraint. Omitting a version also defaults to `latest`.
   - Managed Arch package: add it to the correct public or private required
     package list. Use `dot init` for either list; a full `dot update` also
     installs the public list.
   - Official Arch repository: load `pkexec-root`, then run
     `pkexec pacman -S --needed <package>`.
   - AUR: load `pkexec-root`, then run
     `yay -S --needed <package> --sudo pkexec --sudoflags ""`.
7. Verify both ownership and usability with `mise ls`, `pacman -Q <package>`,
   `command -v <command>`, and the tool's version command as applicable. Run
   `mise reshim` only when a command installed outside mise's normal tool
   installation is missing from the shims.

## Source Rules

- Prefer mise registry shorthand for CLIs, development tools, runtimes, and
  language package managers. The registry selects its configured backend.
- If the registry has no shorthand, prefer a suitable explicit mise backend
  before pacman or yay for user-scoped development tooling.
- Do not treat a successful one-off install as complete when the tool belongs in
  the stowed mise config or a required package list. Persist it through the
  owning dotfiles source and verify that source changed.
- Keep the global `minimum_release_age` setting unchanged. For an intentional
  trusted or high-velocity exception, use
  `mise use --global --minimum-release-age <duration> <tool>@latest` or a
  per-tool table in the global mise config.
- Load and follow `pkexec-root` before every privileged package operation,
  including package conflict removal.
- If the selected AUR package is `mise-bin` and official `mise` is installed,
  confirm the conflict, remove it with `pkexec pacman -Rdd mise`, then install
  `mise-bin` through yay. Do not apply this conflict rule to other packages.
- Record the selected source, backend or package name, and version constraint in
  any config or documentation included in the installation request.

## Examples

```bash
# Registry-backed CLI
mise use --global ripgrep@latest

# Explicit language-package backend
mise use --global npm:typescript@latest

# System-integrated package from the AUR, after loading pkexec-root
yay -S --needed <package> --sudo pkexec --sudoflags ""

# Replace the conflicting official mise package with mise-bin
pkexec pacman -Rdd mise
yay -S --needed mise-bin --sudo pkexec --sudoflags ""
```
