---
title: Changes from the desktop
description: What the Ubuntu server branch removed, changed and added compared with distro/arch-omarchy-quattro.
---

<!-- Generated from git by `mise run docs:gen:distro-diff`. Run it after merging the default branch. Do not edit by hand. -->

This page compares `distro/ubuntu-server` with the default branch, `distro/arch-omarchy-quattro` ([Omarchy desktop](https://dotfiles.timmo.dev/)), from the commit they last shared: `60d8b33`. It only changes when this branch changes or the default branch is merged in, not on every desktop commit.

## Removed folders

Whole top-level folders (mostly stow packages) that this branch does not ship.

| Folder | Files |
| --- | --- |
| [`chromium-extension/`](https://github.com/timmo001/dotfiles/tree/60d8b331373a2f28ffebee3f429f5551e7ed9b06/chromium-extension) | 7 |
| [`cursor/`](https://github.com/timmo001/dotfiles/tree/60d8b331373a2f28ffebee3f429f5551e7ed9b06/cursor) | 2 |
| [`ghostty/`](https://github.com/timmo001/dotfiles/tree/60d8b331373a2f28ffebee3f429f5551e7ed9b06/ghostty) | 6 |
| [`hypr/`](https://github.com/timmo001/dotfiles/tree/60d8b331373a2f28ffebee3f429f5551e7ed9b06/hypr) | 30 |
| [`omarchy/`](https://github.com/timmo001/dotfiles/tree/60d8b331373a2f28ffebee3f429f5551e7ed9b06/omarchy) | 44 |
| [`pacman-hooks/`](https://github.com/timmo001/dotfiles/tree/60d8b331373a2f28ffebee3f429f5551e7ed9b06/pacman-hooks) | 1 |
| [`scripts--laptop/`](https://github.com/timmo001/dotfiles/tree/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts--laptop) | 3 |
| [`systemd--laptop/`](https://github.com/timmo001/dotfiles/tree/60d8b331373a2f28ffebee3f429f5551e7ed9b06/systemd--laptop) | 2 |
| [`uwsm/`](https://github.com/timmo001/dotfiles/tree/60d8b331373a2f28ffebee3f429f5551e7ed9b06/uwsm) | 1 |

## Removed files

46 files removed from folders that stay.

| File | Was |
| --- | --- |
| `.github/workflows/quickshell-lint.yml` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/.github/workflows/quickshell-lint.yml) |
| `.gitmodules` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/.gitmodules) |
| `docs/public/illustrations/desktop.svg` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/public/illustrations/desktop.svg) |
| `docs/src/content/docs/agents/cursor.mdx` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/agents/cursor.mdx) |
| `docs/src/content/docs/desktop/ghostty.mdx` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/desktop/ghostty.mdx) |
| `docs/src/content/docs/desktop/herdr.mdx` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/desktop/herdr.mdx) |
| `docs/src/content/docs/desktop/hyprland.mdx` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/desktop/hyprland.mdx) |
| `docs/src/content/docs/desktop/omarchy-shell.mdx` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/desktop/omarchy-shell.mdx) |
| `docs/src/content/docs/desktop/uwsm.mdx` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/desktop/uwsm.mdx) |
| `dotfiles-skills/.agents/skills/omarchy-shell-quickshell/SKILL.md` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dotfiles-skills/.agents/skills/omarchy-shell-quickshell/SKILL.md) |
| `omarchy-plugins.json` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/omarchy-plugins.json) |
| `scripts/.local/bin/apply-omarchy-patches` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/apply-omarchy-patches) |
| `scripts/.local/bin/doorbell-popup` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/doorbell-popup) |
| `scripts/.local/bin/dot-doctor-notify` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/dot-doctor-notify) |
| `scripts/.local/bin/fastfetch-since-wake` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/fastfetch-since-wake) |
| `scripts/.local/bin/ha-module-bar` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/ha-module-bar) |
| `scripts/.local/bin/ha-watch-singleton` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/ha-watch-singleton) |
| `scripts/.local/bin/launch-floating-webapp` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/launch-floating-webapp) |
| `scripts/.local/bin/launch-on-workspace` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/launch-on-workspace) |
| `scripts/.local/bin/launch-work-browser` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/launch-work-browser) |
| `scripts/.local/bin/link-browser` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/link-browser) |
| `scripts/.local/bin/link-native-host` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/link-native-host) |
| `scripts/.local/bin/link-open-background` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/link-open-background) |
| `scripts/.local/bin/manage-omarchy-plugin` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/manage-omarchy-plugin) |
| `scripts/.local/bin/popup-loading` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/popup-loading) |
| `scripts/.local/bin/power-profile-menu` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/power-profile-menu) |
| `scripts/.local/bin/reboot-to` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/reboot-to) |
| `scripts/.local/bin/singleton-stream` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/singleton-stream) |
| `scripts/.local/bin/terminal-tab-action` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/terminal-tab-action) |
| `scripts/.local/bin/toggle-primary-monitor-hdr` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/toggle-primary-monitor-hdr) |
| `scripts/.local/bin/virt-manager` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/virt-manager) |
| `scripts/.local/bin/workspace-menu` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/workspace-menu) |
| `scripts/.local/bin/workspace-setup` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/bin/workspace-setup) |
| `scripts/.local/share/applications/dot-link.desktop` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/share/applications/dot-link.desktop) |
| `scripts/.local/share/applications/link-browser.desktop` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/share/applications/link-browser.desktop) |
| `scripts/.local/share/applications/plannotator-inbox.desktop` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/share/applications/plannotator-inbox.desktop) |
| `scripts/.local/share/icons/hicolor/256x256/apps/plannotator-inbox.png` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/share/icons/hicolor/256x256/apps/plannotator-inbox.png) |
| `scripts/.local/share/omarchy-patches/agent-crash-hook.patch` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/share/omarchy-patches/agent-crash-hook.patch) |
| `scripts/.local/share/omarchy-patches/plugin-add-hook.patch` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/share/omarchy-patches/plugin-add-hook.patch) |
| `scripts/.local/share/omarchy-patches/plugin-remove-hook.patch` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/share/omarchy-patches/plugin-remove-hook.patch) |
| `scripts/.local/share/omarchy-patches/plugin-update-hook.patch` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/share/omarchy-patches/plugin-update-hook.patch) |
| `scripts/.local/share/plannotator-inbox/Inbox.qml` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/share/plannotator-inbox/Inbox.qml) |
| `scripts/.local/share/workspace-relayout/presets.json` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/scripts/.local/share/workspace-relayout/presets.json) |
| `systemd/.config/systemd/user/background.slice.d/10-oomd.conf` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/systemd/.config/systemd/user/background.slice.d/10-oomd.conf) |
| `tests/scripts/hypr-lua-dispatchers.test.sh` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/tests/scripts/hypr-lua-dispatchers.test.sh) |
| `zsh/.local/share/zsh/site-functions/_omarchy` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/zsh/.local/share/zsh/site-functions/_omarchy) |

## Changed files

25 files in both branches with different contents.

| File | Lines | Compare |
| --- | --- | --- |
| `.agents/skills/dotfiles-docs/SKILL.md` | +1 -0 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/.agents/skills/dotfiles-docs/SKILL.md), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/.agents/skills/dotfiles-docs/SKILL.md) |
| `.dot-public-packages` | +35 -22 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/.dot-public-packages), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/.dot-public-packages) |
| `.stowrc` | +1 -0 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/.stowrc), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/.stowrc) |
| `AGENTS.md` | +9 -11 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/AGENTS.md), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/AGENTS.md) |
| `docs/AGENTS.md` | +14 -0 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/AGENTS.md), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/AGENTS.md) |
| `docs/blume.config.ts` | +28 -17 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/blume.config.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/blume.config.ts) |
| `docs/package.json` | +1 -0 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/package.json), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/package.json) |
| `docs/README.md` | +1 -1 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/README.md), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/README.md) |
| `docs/src/content/docs/agents/overview.mdx` | +2 -3 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/agents/overview.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/agents/overview.mdx) |
| `docs/src/content/docs/configuration.mdx` | +4 -5 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/configuration.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/configuration.mdx) |
| `docs/src/content/docs/development/home-assistant.mdx` | +1 -1 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/development/home-assistant.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/development/home-assistant.mdx) |
| `docs/src/content/docs/dot/overview.mdx` | +4 -0 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/dot/overview.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/dot/overview.mdx) |
| `docs/src/content/docs/getting-started.mdx` | +3 -3 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/getting-started.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/getting-started.mdx) |
| `docs/src/content/docs/index.mdx` | +14 -17 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/index.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/index.mdx) |
| `docs/src/content/docs/stow.mdx` | +3 -5 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/stow.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/stow.mdx) |
| `docs/wrangler.jsonc` | +2 -2 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/wrangler.jsonc), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/wrangler.jsonc) |
| `fastfetch/.config/fastfetch/config.jsonc` | +13 -64 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/fastfetch/.config/fastfetch/config.jsonc), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/fastfetch/.config/fastfetch/config.jsonc) |
| `herdr/.config/herdr/config.toml` | +14 -1 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/herdr/.config/herdr/config.toml), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/herdr/.config/herdr/config.toml) |
| `lazygit/.config/lazygit/config.yml` | +4 -19 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/lazygit/.config/lazygit/config.yml), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/lazygit/.config/lazygit/config.yml) |
| `mise.toml` | +6 -18 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/mise.toml), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/mise.toml) |
| `README.md` | +14 -11 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/README.md), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/README.md) |
| `systemd/.config/systemd/user/dot-doctor.service` | +8 -4 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/systemd/.config/systemd/user/dot-doctor.service), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/systemd/.config/systemd/user/dot-doctor.service) |
| `tmux/.config/tmux/tmux.conf` | +1 -1 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/tmux/.config/tmux/tmux.conf), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/tmux/.config/tmux/tmux.conf) |
| `topgrade/.config/topgrade.toml` | +7 -11 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/topgrade/.config/topgrade.toml), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/topgrade/.config/topgrade.toml) |
| `zsh/.zshrc` | +39 -49 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/zsh/.zshrc), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/zsh/.zshrc) |

## Added files

9 files only on this branch.

| File | Lines |
| --- | --- |
| [`docs/current-distro.ts`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/current-distro.ts) | +7 -0 |
| [`docs/distros.ts`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/distros.ts) | +61 -0 |
| [`docs/scripts/generate-distro-diff.ts`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/scripts/generate-distro-diff.ts) | +163 -0 |
| [`docs/src/content/docs/distros.mdx`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/distros.mdx) | +24 -0 |
| [`docs/src/content/docs/server/herdr.mdx`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/server/herdr.mdx) | +36 -0 |
| [`docs/src/content/docs/server/overview.mdx`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/server/overview.mdx) | +28 -0 |
| [`SERVER.md`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/SERVER.md) | +87 -0 |
| [`systemd/.config/dot/services.d/herdr.yml`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/systemd/.config/dot/services.d/herdr.yml) | +6 -0 |
| [`systemd/.config/systemd/user/herdr.service`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/systemd/.config/systemd/user/herdr.service) | +22 -0 |
