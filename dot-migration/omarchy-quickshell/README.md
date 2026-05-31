# Omarchy Quickshell Migration Plan

This file is temporary planning material for the Omarchy 4 Quickshell migration. It lives in `dot-migration/` because that directory is ignored by stow, so these notes and draft files can exist on the dotfiles branch without being installed into the live home directory.

The likely long-term home is a separate `omarchy-quickshell` repository. Do not create that repository yet. Treat this directory as the staging area for the VM migration plan, draft shell config, and checklist.

## Current Action

For this PR branch, the active work is:

1. Record the upstream Omarchy Quickshell extension point.
2. Keep a single tracked plan and checklist in this file.
3. Keep the PR body short and link here instead of duplicating the migration plan.
4. Avoid live activation on the host machine.

No file in this directory should be stowed. The host remains on Omarchy 3 until the Omarchy 4 work passes VM validation.

## Upstream Baseline

- Upstream PR: <https://github.com/basecamp/omarchy/pull/5856>
- Upstream branch: `omarchy-shell`
- Extension commit: `1bb439476af2a7b2bdee03c682ae002655c3523c`
- Default shell config at that commit: `config/omarchy/shell.json`
- Local comparison worktree used during planning: `/tmp/opencode/omarchy-shell`

The Omarchy PR default config is the baseline. Do not derive the Quickshell user config directly from the current Waybar config. Use the upstream `shell.json` shape first, then layer custom modules and host-specific choices into a user config for VM testing.

If `basecamp/omarchy#5856` advances, compare the new head against `1bb439476af2a7b2bdee03c682ae002655c3523c` before applying this checklist.

## Scope

This plan covers dotfiles-side preparation for Omarchy 4 and VM validation.

In scope:

1. Draft an Omarchy Quickshell migration plan in this ignored dotfiles path.
2. Use the Omarchy PR default `shell.json` as the extension point.
3. Keep command and script changes compatible with the current Omarchy 3 host where practical.
4. Prepare VM checklist and validation criteria for Omarchy 4.
5. Identify which current Waybar modules become built-ins, command modules, QML modules, or deferred work.
6. Keep Hypr Lua migration requirements visible alongside the shell migration.

Out of scope for this PR branch:

1. Creating the future `omarchy-quickshell` repository.
2. Writing live `~/.config/omarchy/shell.json` on the host.
3. Switching the host machine to Omarchy 4.
4. Deleting the current Waybar, hypridle, or hyprlock configs before VM validation.
5. Editing `~/.local/share/omarchy`.

## Quickshell Extension Model

The PR makes Omarchy's desktop shell intentionally extensible.

Important rules:

1. `~/.config/omarchy/shell.json` becomes canonical once it exists. It does not deep-merge with the default config.
2. Built-in widget IDs use the reserved `omarchy.*` namespace.
3. Custom IDs should use a separate namespace such as `timmo.*`.
4. One-off command modules can be declared inline in `bar.layout.left`, `bar.layout.center`, or `bar.layout.right`.
5. Command module output can be plain text or Waybar-style JSON containing `text`, `tooltip`, and `class`.
6. Command modules run on an interval and parse output after the command exits. They are suitable for polling, not long-running streams.
7. Custom QML modules can live under `~/.config/omarchy/bar/modules/<id>.qml`, or an entry can provide an explicit `source` path.
8. Full plugins live under `~/.config/omarchy/plugins/<id>/manifest.json` and can declare `bar-widget`, `panel`, `overlay`, `menu`, or `service` kinds.
9. Plugins are unsandboxed code running inside `omarchy-shell`, so custom QML should stay small and auditable.
10. Waybar `signal = RTMIN+N` refresh behavior does not map directly. Future modules should use polling or shell IPC instead.
11. Waybar CSS class semantics do not map directly. Command modules currently use `class` or `alt` mainly to determine active styling.

## Temporary File Layout

Use this ignored staging layout while the future repository does not exist:

```text
dot-migration/omarchy-quickshell/
  README.md                 # this plan and checklist
  shell.json                # optional future draft copied from Omarchy PR default
  modules.md                # optional deeper module inventory if this file gets too large
  bar/modules/              # optional future one-off QML module prototypes
  plugins/                  # optional future full plugin prototypes
```

Only create the optional files when they are needed. This PR starts with the plan file.

## Waybar To Shell Mapping

Start with the Omarchy PR default bar layout, then map current custom behavior onto it.

| Current Waybar module | Omarchy 4 target | Notes |
| --- | --- | --- |
| `custom/omarchy` | `omarchy.menu` | Built-in menu widget. |
| `hyprland/workspaces` | `omarchy.workspaces` | Built-in workspaces widget. |
| `clock` | `omarchy.clock` | Built-in clock widget; configure format inline. |
| `custom/update` | `omarchy.system-update` | Built-in update widget. |
| `group/tray-expander`, `tray`, `custom/expand-icon` | `omarchy.tray` | Built-in tray handles drawer behavior. |
| `bluetooth` | `omarchy.bluetooth` | Built-in panel/widget. |
| `network` | `omarchy.network` | Built-in panel/widget; verify NetworkManager behavior in VM. |
| `pulseaudio` | `omarchy.audio` | Built-in audio panel/widget. |
| `cpu`, `memory`, `battery` | `omarchy.monitor` / `omarchy.power` | Use built-ins first; only add custom output if needed. |
| `custom/screenrecording-indicator` | `omarchy.indicators` item | Built-in indicator support. |
| `custom/idle-indicator` | `omarchy.indicators` item | Maps to shell idle/stay-awake behavior. |
| `custom/notification-silencing-indicator` | `omarchy.indicators` item | Maps to DND indicator. |
| `custom/voxtype` | `omarchy.indicators` item | Built-in dictation indicator; verify click behavior differences. |
| `custom/git-diff` | `timmo.git-diff` command module | Polling command module; remove Waybar signal dependency. |
| `custom/git-notifications` | `timmo.git-notifications` command module | Polling command module; open/refresh clicks need shell-compatible behavior. |
| `custom/git-workflows` | `timmo.git-workflows` command module | Polling command module; no RTMIN refresh equivalent. |
| `custom/twitch-notifications-active` | `timmo.twitch-notifications` command module | Good command-module candidate using `--status-bar-json`. |
| `custom/temperature` | `timmo.temperature` command module | Polling Home Assistant status. |
| `custom/co2-alert` | `timmo.co2-alert` command module | Polling Home Assistant status; class styling may need adjustment. |
| `custom/voc-alert` | `timmo.voc-alert` command module or omit | Desktop currently hides this permanently; verify need. |
| `custom/nas-activity` | `timmo.nas-activity` command module | Polling Home Assistant status. |
| `custom/current-next-event` | `timmo.current-next-event` command module | Polling Home Assistant status. |
| `custom/in-a-call` | QML/service or rewritten one-shot command | Current behavior is a streaming watcher. |
| `custom/time-check` | QML/service or rewritten one-shot command | Current behavior is a streaming watcher. |
| `custom/heating` | QML/service or rewritten one-shot command | Current behavior is a streaming watcher. |
| `custom/rain` | QML/service or rewritten one-shot command | Current behavior is a streaming watcher. |
| `custom/doorbell` | QML/service plugin | Stateful stream, trigger command, cooldown, and host-specific monitor geometry. |

## Script Changes Needed

Script work should preserve current host behavior while making the Omarchy 4 VM path clear.

1. Replace direct `omarchy-launch-walker` assumptions with an abstraction that uses `omarchy-menu-select` when available and falls back to the current Walker launcher while the host remains on Omarchy 3.
2. Apply that to `twitch-menu`, `workspace-menu`, and `workspace-relayout`.
3. Split generic status-bar JSON output from Waybar-specific refresh behavior in the git status scripts.
4. Keep Waybar-specific wrappers working until the host leaves Omarchy 3.
5. Avoid adding new `--waybar` or `--status-waybar` aliases. Use `--bar-json` and `--status-bar-json` only.

## Hypr Lua Checklist

Current Hypr Lua prep exists in `timmo001/omarchy-hypr`, but Omarchy 4 migration still needs VM validation.

Before enabling Omarchy 4 in the VM:

1. Preserve prepared root Lua files from upstream migration clobbering, especially `hyprland.lua`, `bindings.lua`, `autostart.lua`, `input.lua`, `looknfeel.lua`, and `monitors.lua`.
2. Confirm `hyprland.lua` still requires the local `hypr.envs` module if needed.
3. Re-check local binding conflicts against Omarchy 4 defaults and add explicit `hl.unbind(...)` calls where local bindings intentionally replace defaults.
4. Keep host-specific monitor behavior in `hosts/desktop` and `hosts/laptop`.
5. Treat `hypridle.conf` and `hyprlock.conf` as Omarchy 3-only once shell idle/lock are active.
6. Move idle timing to `shell.json` after Omarchy 4 shell idle service is active.
7. Verify `hyprsunset` laptop-specific behavior does not conflict with Omarchy 4 night-light behavior.

## Theme Checklist

Omarchy 4 moves more visual behavior into shell theme tokens.

For each custom theme that should survive the migration:

1. Keep `colors.toml` as the palette source where available.
2. Add or update `shell.toml` for bar, menu, launcher, notification, lock, and shared control tokens.
3. Convert Hypr theme overrides from `hyprland.conf` to `hyprland.lua` where needed.
4. Revisit Mako settings because shell notifications replace Mako.
5. Revisit Waybar CSS because it will not apply to Quickshell widgets.
6. Verify current background and unlock assets still match Omarchy 4 background and lock behavior.

## VM Test Checklist

Use the VM as the first activation target.

Base setup:

1. Install or switch the VM to the Omarchy 4 branch represented by the chosen upstream commit.
2. Confirm the VM's Omarchy checkout matches or intentionally supersedes `1bb439476af2a7b2bdee03c682ae002655c3523c`.
3. Apply dotfiles branches needed for this PR.
4. Apply Hypr Lua branch/config needed for host override testing.
5. Copy or adapt the draft `shell.json` from this migration directory only after reviewing the current upstream default.

Shell validation:

1. `omarchy-shell` starts without QML errors.
2. `omarchy shell shell ping` or equivalent IPC health check succeeds.
3. Default built-in widgets render before adding custom modules.
4. Command modules render last-line JSON correctly.
5. Click handlers work with `onClick`, `onRightClick`, and `onMiddleClick` naming.
6. Missing secrets or services degrade gracefully for Home Assistant, GitHub, and Twitch modules.
7. No custom module relies on Waybar RTMIN signals.
8. No custom module relies on Waybar CSS classes for essential behavior.

Hypr validation:

1. Hyprland starts from Lua config.
2. `hyprctl reload` succeeds.
3. `hyprctl configerrors` is clean or contains only understood upstream issues.
4. Desktop and laptop host-selection behavior is still clear.
5. Resume recovery still works without `hypridle` `after_sleep_cmd`.
6. Lock, idle, screensaver, and wake behavior are verified through Omarchy shell services.

Desktop behavior validation:

1. Menus open through the shell menu path instead of Walker-only paths.
2. Workspace menu and relayout flows work.
3. Twitch menu works.
4. Git diff, GitHub notification, and workflow modules show expected status.
5. Doorbell behavior is either explicitly deferred or implemented through a QML/service plugin.
6. Network and Wi-Fi behavior works with NetworkManager.
7. Notification and OSD behavior match the intended theme.

## Promotion Criteria

Promote this work out of `dot-migration/` only when all of these are true:

1. The VM passes the shell and Hypr validation checklist.
2. The selected upstream Omarchy commit is either merged, tagged, or intentionally accepted as the target.
3. The future `omarchy-quickshell` repository layout is decided.
4. Draft files are moved from this temporary directory into the final repo or replaced with links to that repo.
5. Host activation is reviewed separately from the PR that only prepares dotfiles.

## Open Decisions

1. Whether git status modules should remain shell command modules or become a small shared QML plugin with explicit refresh IPC.
2. Whether Home Assistant streaming modules should be rewritten as one-shot polling commands or implemented as a QML service plugin.
3. Whether desktop and laptop should share a single `shell.json` with host-specific scripts, or separate generated user configs in the future `omarchy-quickshell` repo.
4. Which custom themes are worth fully porting to `shell.toml` before host activation.
