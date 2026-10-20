---
title: Changes from the desktop
description: What the Ubuntu server branch removed, changed and added compared with distro/arch-omarchy-quattro.
---

<!-- Generated from git by `mise run docs:gen:distro-diff`. Do not edit by hand. -->

This page compares `distro/ubuntu-server` with the default branch, `distro/arch-omarchy-quattro` ([Omarchy desktop](https://dotfiles.timmo.dev/)), from the commit they last shared: `60d8b33`. It moves when this branch changes or is rebased onto the default branch, not on every desktop commit.

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

78 files removed from folders that stay.

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
| `dot/src/commands/LaunchFloatingWebapp.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/LaunchFloatingWebapp.ts) |
| `dot/src/commands/LinkGit.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/LinkGit.ts) |
| `dot/src/commands/LinkNativeHost.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/LinkNativeHost.ts) |
| `dot/src/commands/LinkOpen.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/LinkOpen.ts) |
| `dot/src/commands/OmarchyComponents.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/OmarchyComponents.ts) |
| `dot/src/commands/OmarchyPlugin.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/OmarchyPlugin.ts) |
| `dot/src/commands/PlannotatorInbox.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/PlannotatorInbox.ts) |
| `dot/src/commands/PrivatePkgPublish.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/PrivatePkgPublish.ts) |
| `dot/src/commands/SetupPrivateRepo.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/SetupPrivateRepo.ts) |
| `dot/src/commands/SetupPublicRepo.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/SetupPublicRepo.ts) |
| `dot/src/commands/WorkspaceRelayout.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/WorkspaceRelayout.ts) |
| `dot/src/commands/WorkspaceSetup.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/WorkspaceSetup.ts) |
| `dot/src/doctor/checks/browserExtensions.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/browserExtensions.ts) |
| `dot/src/doctor/checks/browserFlags.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/browserFlags.ts) |
| `dot/src/doctor/checks/defaultBrowser.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/defaultBrowser.ts) |
| `dot/src/doctor/checks/dotLinks.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/dotLinks.ts) |
| `dot/src/doctor/checks/fileManager.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/fileManager.ts) |
| `dot/src/doctor/checks/hardwareVideo.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/hardwareVideo.ts) |
| `dot/src/doctor/checks/omarchy.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/omarchy.ts) |
| `dot/src/doctor/checks/omarchyNvim.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/omarchyNvim.ts) |
| `dot/src/doctor/checks/pacmanHooks.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/pacmanHooks.ts) |
| `dot/src/doctor/checks/retiredApps.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/retiredApps.ts) |
| `dot/src/git/commands/Web.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/git/commands/Web.ts) |
| `dot/src/git/itemLinks.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/git/itemLinks.ts) |
| `dot/src/lib/dotLinksExtension.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/dotLinksExtension.ts) |
| `dot/src/lib/omarchyCrashCapture.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/omarchyCrashCapture.ts) |
| `dot/src/lib/omarchyHost.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/omarchyHost.ts) |
| `dot/src/lib/omarchyNvim.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/omarchyNvim.ts) |
| `dot/src/lib/omarchyPluginDeployment.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/omarchyPluginDeployment.ts) |
| `dot/src/lib/omarchyShellConfig.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/omarchyShellConfig.ts) |
| `dot/src/lib/workspaceMutationLock.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/workspaceMutationLock.ts) |
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
| `tests/dot/omarchy-plugin-deployment.test.ts` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/tests/dot/omarchy-plugin-deployment.test.ts) |
| `tests/scripts/hypr-lua-dispatchers.test.sh` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/tests/scripts/hypr-lua-dispatchers.test.sh) |
| `zsh/.local/share/zsh/site-functions/_omarchy` | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/zsh/.local/share/zsh/site-functions/_omarchy) |

## Changed files

72 files in both branches with different contents.

| File | Lines | Compare |
| --- | --- | --- |
| `.agents/skills/dotfiles-docs/SKILL.md` | +1 -0 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/.agents/skills/dotfiles-docs/SKILL.md), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/.agents/skills/dotfiles-docs/SKILL.md) |
| `.dot-public-packages` | +22 -23 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/.dot-public-packages), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/.dot-public-packages) |
| `.stowrc` | +1 -0 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/.stowrc), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/.stowrc) |
| `AGENTS.md` | +30 -11 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/AGENTS.md), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/AGENTS.md) |
| `docs/AGENTS.md` | +16 -0 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/AGENTS.md), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/AGENTS.md) |
| `docs/blume.config.ts` | +28 -17 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/blume.config.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/blume.config.ts) |
| `docs/package.json` | +2 -1 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/package.json), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/package.json) |
| `docs/README.md` | +1 -1 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/README.md), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/README.md) |
| `docs/src/content/docs/agents/overview.mdx` | +2 -3 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/agents/overview.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/agents/overview.mdx) |
| `docs/src/content/docs/configuration.mdx` | +4 -5 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/configuration.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/configuration.mdx) |
| `docs/src/content/docs/development/home-assistant.mdx` | +1 -1 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/development/home-assistant.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/development/home-assistant.mdx) |
| `docs/src/content/docs/dot/commands.md` | +24 -657 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/dot/commands.md), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/dot/commands.md) |
| `docs/src/content/docs/dot/overview.mdx` | +4 -0 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/dot/overview.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/dot/overview.mdx) |
| `docs/src/content/docs/getting-started.mdx` | +3 -3 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/getting-started.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/getting-started.mdx) |
| `docs/src/content/docs/index.mdx` | +14 -17 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/index.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/index.mdx) |
| `docs/src/content/docs/stow.mdx` | +3 -5 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/src/content/docs/stow.mdx), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/stow.mdx) |
| `docs/wrangler.jsonc` | +2 -2 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/docs/wrangler.jsonc), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/wrangler.jsonc) |
| `dot/src/brief/config.ts` | +3 -5 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/brief/config.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/brief/config.ts) |
| `dot/src/cli/spec.ts` | +38 -624 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/cli/spec.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/cli/spec.ts) |
| `dot/src/commands/Brief.ts` | +6 -35 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/Brief.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/Brief.ts) |
| `dot/src/commands/Clean.ts` | +1 -2 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/Clean.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/Clean.ts) |
| `dot/src/commands/Fans.ts` | +0 -7 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/Fans.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/Fans.ts) |
| `dot/src/commands/HerdrRepoOpen.ts` | +8 -80 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/HerdrRepoOpen.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/HerdrRepoOpen.ts) |
| `dot/src/commands/HerdrServer.ts` | +12 -79 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/HerdrServer.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/HerdrServer.ts) |
| `dot/src/commands/Init.ts` | +13 -353 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/Init.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/Init.ts) |
| `dot/src/commands/Install.ts` | +20 -12 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/Install.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/Install.ts) |
| `dot/src/commands/Reload.ts` | +9 -186 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/Reload.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/Reload.ts) |
| `dot/src/commands/Services.ts` | +6 -22 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/Services.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/Services.ts) |
| `dot/src/commands/Stow.ts` | +3 -37 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/Stow.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/Stow.ts) |
| `dot/src/commands/SystemUpdate.ts` | +15 -171 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/SystemUpdate.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/SystemUpdate.ts) |
| `dot/src/commands/Tunnel.ts` | +1 -9 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/Tunnel.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/Tunnel.ts) |
| `dot/src/commands/Update.ts` | +17 -119 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/Update.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/Update.ts) |
| `dot/src/commands/Updates.ts` | +15 -90 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/commands/Updates.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/commands/Updates.ts) |
| `dot/src/doctor/checks/dependencies.ts` | +2 -28 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/dependencies.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/doctor/checks/dependencies.ts) |
| `dot/src/doctor/checks/packages.ts` | +70 -597 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/packages.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/doctor/checks/packages.ts) |
| `dot/src/doctor/checks/stow.ts` | +1 -1 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/stow.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/doctor/checks/stow.ts) |
| `dot/src/doctor/checks/systemd.ts` | +1 -180 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/checks/systemd.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/doctor/checks/systemd.ts) |
| `dot/src/doctor/runner.ts` | +1 -43 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/doctor/runner.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/doctor/runner.ts) |
| `dot/src/git/commands/Issues.ts` | +0 -15 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/git/commands/Issues.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/git/commands/Issues.ts) |
| `dot/src/git/commands/Notifications.ts` | +0 -11 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/git/commands/Notifications.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/git/commands/Notifications.ts) |
| `dot/src/git/commands/PullRequests.ts` | +0 -16 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/git/commands/PullRequests.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/git/commands/PullRequests.ts) |
| `dot/src/git/commands/Releases.ts` | +0 -15 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/git/commands/Releases.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/git/commands/Releases.ts) |
| `dot/src/git/services/DotDiff.ts` | +1 -63 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/git/services/DotDiff.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/git/services/DotDiff.ts) |
| `dot/src/git/services/GitReleases.ts` | +5 -20 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/git/services/GitReleases.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/git/services/GitReleases.ts) |
| `dot/src/lib/aptPackages.ts` (was `dot/src/lib/archPackages.ts`) | +6 -2 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/archPackages.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/lib/aptPackages.ts) |
| `dot/src/lib/env.ts` | +0 -12 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/env.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/lib/env.ts) |
| `dot/src/lib/initState.ts` | +0 -2 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/initState.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/lib/initState.ts) |
| `dot/src/lib/linkBrowser.ts` | +1 -325 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/linkBrowser.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/lib/linkBrowser.ts) |
| `dot/src/lib/miseTrust.ts` | +2 -8 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/miseTrust.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/lib/miseTrust.ts) |
| `dot/src/lib/packageSetup.ts` | +61 -257 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/packageSetup.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/lib/packageSetup.ts) |
| `dot/src/lib/stowConflicts.ts` | +1 -112 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/stowConflicts.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/lib/stowConflicts.ts) |
| `dot/src/lib/stowFolders.ts` | +8 -26 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/stowFolders.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/lib/stowFolders.ts) |
| `dot/src/lib/stowPackages.ts` | +13 -153 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/stowPackages.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/lib/stowPackages.ts) |
| `dot/src/lib/updateMaintenance.ts` | +2 -11 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/lib/updateMaintenance.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/lib/updateMaintenance.ts) |
| `dot/src/services/Config.ts` | +0 -38 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/services/Config.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/services/Config.ts) |
| `dot/src/services/GitConfig.ts` | +1 -102 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/services/GitConfig.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/services/GitConfig.ts) |
| `dot/src/types.ts` | +2 -3 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/dot/src/types.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/types.ts) |
| `fastfetch/.config/fastfetch/config.jsonc` | +13 -64 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/fastfetch/.config/fastfetch/config.jsonc), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/fastfetch/.config/fastfetch/config.jsonc) |
| `herdr/.config/herdr/config.toml` | +14 -1 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/herdr/.config/herdr/config.toml), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/herdr/.config/herdr/config.toml) |
| `lazygit/.config/lazygit/config.yml` | +4 -19 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/lazygit/.config/lazygit/config.yml), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/lazygit/.config/lazygit/config.yml) |
| `mise.toml` | +7 -19 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/mise.toml), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/mise.toml) |
| `mise/.config/mise/config.toml` | +11 -4 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/mise/.config/mise/config.toml), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/mise/.config/mise/config.toml) |
| `README.md` | +14 -11 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/README.md), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/README.md) |
| `systemd/.config/systemd/user/dot-doctor.service` | +8 -4 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/systemd/.config/systemd/user/dot-doctor.service), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/systemd/.config/systemd/user/dot-doctor.service) |
| `tests/dot/git-diff-index-lock.test.sh` | +0 -2 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/tests/dot/git-diff-index-lock.test.sh), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/tests/dot/git-diff-index-lock.test.sh) |
| `tests/dot/git-notification-dismissal.test.ts` | +1 -1 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/tests/dot/git-notification-dismissal.test.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/tests/dot/git-notification-dismissal.test.ts) |
| `tests/dot/git-releases-contract.test.ts` | +2 -3 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/tests/dot/git-releases-contract.test.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/tests/dot/git-releases-contract.test.ts) |
| `tests/dot/herdr-launch-contract.test.ts` | +0 -1 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/tests/dot/herdr-launch-contract.test.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/tests/dot/herdr-launch-contract.test.ts) |
| `tests/dot/services-outcomes.test.ts` | +0 -8 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/tests/dot/services-outcomes.test.ts), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/tests/dot/services-outcomes.test.ts) |
| `tmux/.config/tmux/tmux.conf` | +1 -1 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/tmux/.config/tmux/tmux.conf), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/tmux/.config/tmux/tmux.conf) |
| `topgrade/.config/topgrade.toml` | +6 -11 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/topgrade/.config/topgrade.toml), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/topgrade/.config/topgrade.toml) |
| `zsh/.zshrc` | +38 -86 | [desktop](https://github.com/timmo001/dotfiles/blob/60d8b331373a2f28ffebee3f429f5551e7ed9b06/zsh/.zshrc), [server](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/zsh/.zshrc) |

## Added files

10 files only on this branch.

| File | Lines |
| --- | --- |
| [`docs/current-distro.ts`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/current-distro.ts) | +7 -0 |
| [`docs/distros.ts`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/distros.ts) | +61 -0 |
| [`docs/scripts/generate-distro-diff.ts`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/scripts/generate-distro-diff.ts) | +181 -0 |
| [`docs/src/content/docs/distros.mdx`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/distros.mdx) | +24 -0 |
| [`docs/src/content/docs/server/herdr.mdx`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/server/herdr.mdx) | +36 -0 |
| [`docs/src/content/docs/server/overview.mdx`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/docs/src/content/docs/server/overview.mdx) | +28 -0 |
| [`dot/src/lib/notify.ts`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/dot/src/lib/notify.ts) | +28 -0 |
| [`SERVER.md`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/SERVER.md) | +87 -0 |
| [`systemd/.config/dot/services.d/herdr.yml`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/systemd/.config/dot/services.d/herdr.yml) | +6 -0 |
| [`systemd/.config/systemd/user/herdr.service`](https://github.com/timmo001/dotfiles/blob/distro/ubuntu-server/systemd/.config/systemd/user/herdr.service) | +22 -0 |
