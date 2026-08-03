---
title: System Utilities
description: Health checks, system updates, benchmarks, and optional timers.
sidebar:
  order: 5
---

## System health check

`system-health-check` is a friendly multi-snapshot system health report covering CPU, memory, network, pressure, and known logs.

```bash
system-health-check                 # write a health report
system-health-check --open-opencode # run opencode run against the report, then open an interactive session
```

Add `--open-opencode` to run `opencode run` against the saved report and then open a full interactive OpenCode session with `opencode --continue`.

## Times

`times` prints current local, Pacific, Mountain, Central, and Eastern times. `SUPER+CTRL+ALT+T` shows an aligned compact version in a desktop notification.

```bash
times
```

## Git branch sync

`git-default-ref` is the shared guarded resolver for default-branch operations. It prefers `upstream`, falls back to `origin`, compares the remote's advertised default branch with local `<remote>/HEAD`, and fetches the branch. A missing or mismatched local ref requires confirmation before repair. Under `dot is-agent`, or without an interactive terminal, it fails instead of prompting.

The wrappers print section headings and the resolved remote, branch, comparison range, or operation before running Git. Operational detail goes to stderr for `git-diff-default` and `git-log-default`, leaving their Git output clean for piping.

- `git-switch-default` (`gsd`) switches to the default branch and fast-forwards it to the fetched remote branch. `gsdp` then runs `gh poi` under a separate cleanup section.
- `git-rebase-default` (`grd`) rebases the checked-out branch onto the default branch with `--autostash`. Press `Ctrl+F` in Lazygit's Local Branches panel to run it. Use `gra` to abort a rebase in progress.
- `git-diff-default` (`gdd`) shows the current branch diff from its merge base with the default branch.
- `git-log-default` (`gld`) shows commits on the current branch since it diverged from the default branch.

## System updates

[topgrade](https://github.com/topgrade-rs/topgrade) runs the machine's update steps (AUR via `yay`, Flatpak, firmware checks, `mise` tools, `rustup`, `cargo`, and more) in one pass. The repo stows a tuned config to `~/.config/topgrade.toml` and a logging wrapper at `scripts/.local/bin/topgrade` that shadows the system binary via `~/.local/bin` on `PATH`.

```bash
topgrade            # full run (all enabled steps)
topgrade mise cargo # run only named steps
```

- The wrapper logs the full session to `$XDG_STATE_HOME/topgrade.log` (default `~/.local/state/topgrade.log`) with `script`, mirroring the `omarchy-update` pattern, so you can review a run afterwards.
- It adds `--sudoloop` automatically when a run includes steps that need root (a full run, or the `system`, `firmware`, or `containers` steps) so credentials stay cached during long runs, and skips it for user-only steps.
- Firmware is check-only. The `mise` step still runs but does not auto-bump toolchain versions (`[mise] bump = false` in the stowed config); use `mise install` or `dot update` to move pins forward. `yay` runs with `--noconfirm --cleanafter`.
- Steps managed elsewhere or unused are disabled (for example `bun`, `deno`, `go`, and `pnpm` come from `mise`; `hyprpm` is skipped because it drops the shared sudo credential). A desktop notification fires only on failure.

## Benchmarks and diagnostics

The stowed utility scripts include a quick system benchmark and an ambient resource-growth diagnostic:

- `system-quick-benchmark` - short CPU/memory/network benchmark snapshot.
- `system-resource-leak-check` - samples whole-system memory, swap, pressure, and sockets over time. It is a diagnostic, not a deterministic test.

```bash
# Quick benchmark (minimal defaults)
system-quick-benchmark

# Include LAN throughput (requires an iperf3 target)
system-quick-benchmark --iperf-host 192.168.1.50

# Resource growth diagnostic
system-resource-leak-check
```

- Reports are written beneath `$XDG_STATE_HOME` (default `~/.local/state`) in directories matching each command name. Use `--output` to select another path.
- LAN network throughput is opt-in and requires `--iperf-host`.
- Scripts use ANSI colour output by default; set `NO_COLOR=1` to disable.
- All scripts include an uptime/load snapshot near the top of output.

`dot doctor` also checks the system VA-API drivers and Chromium flag files. Chromium enables its Linux GL decode and zero-copy capability checks by default, so the doctor accepts flag files without explicit acceleration features. It warns about obsolete VA-API feature names and explicit acceleration disablement.

Driver capability does not prove smooth playback. For a live stream, use `chrome://media-internals` to confirm `kVideoDecoderName` is `VaapiVideoDecoder` and `kIsPlatformVideoDecoder` is `true`, then inspect dropped frames and buffering separately.

Repository regression tests live under `tests/`, use temporary directories, and run through mise tasks and the `lint.yml` workflow:

- `tests/github/opencode-publish.test.sh` checks publication of shared `lib/` modules and rejects missing relative plugin imports before cleaning the publish checkout.
- `tests/scripts/workspace-restore.test.sh` checks that captured browser URLs remain one shell argument and cannot execute command substitutions during restore.
- `tests/dot/cli-smoke.test.sh` builds `dot` and checks side-effect-free CLI entry points.

The `lint.yml` `validate-skills` job uses the shared `lint-agent-skills` workflow to validate public `SKILL.md` files with [`skills-ref`](https://github.com/agentskills/agentskills/tree/main/skills-ref).

The `mise-toolchain.yml` workflow runs when the stowed global mise config changes. It force-builds Terminal Control with the pinned Rust and Zig toolchain, catching incompatible automated version updates before they merge.

Run `mise run tests:integration` for deterministic repository tests and `mise run tests:smoke` for the build plus CLI smoke checks. TypeScript unit tests mirror `dot/src/` under `dot/tests/` and run through `mise run dot:test`.

## Firewall rules

`dot firewall` configures a managed set of [ufw](https://wiki.archlinux.org/title/Uncomplicated_Firewall) rules, `dot init` runs it during first-use setup, and `dot doctor` verifies the rules are still present. The setup reads the world-readable ufw rules file first, so a fully configured machine adds nothing and never prompts for a password. When changes are needed, missing or stale-comment rules are applied in one elevated batch, followed by a single `ufw reload`, so the firewall step should only ask for authentication once. Each rule is tagged with its purpose as a ufw comment, so it appears in `ufw status`.

Most rules are inbound port allows on any interface. The libvirt rules are scoped to the `virbr0` bridge: two inbound allows for guest DHCP and DNS, plus a forwarding (route) allow so the default NAT network can route guest traffic off the bridge. Without them, ufw's default `deny (incoming)` and `deny (routed)` policy leaves guests without an address or internet access.

Rule identity includes the complete ufw tuple: source, destination, protocol/port, and interface/direction. A source-restricted existing rule does not satisfy a managed any-source rule, so `dot firewall` adds the broader managed rule rather than treating the restricted rule as equivalent.

| Port(s) | Protocol | Scope | Purpose |
| --- | --- | --- | --- |
| `1714:1764` | UDP + TCP | any | KDE Connect device discovery and transfer. |
| `8123` | TCP | any | Home Assistant frontend. |
| `8124` | TCP | any | Home Assistant companion port. |
| `4096` | TCP | any | OpenCode local server. |
| `53317` | UDP + TCP | any | LocalSend device discovery and transfer. |
| `67` | UDP | `virbr0` | libvirt guest DHCP. |
| `53` | TCP + UDP | `virbr0` | libvirt guest DNS. |
| forward | any | `virbr0` | libvirt NAT: forward guest traffic off the bridge. |

If `ufw` is not installed, firewall setup and doctor skip the firewall step with a warning. The doctor check reports any missing rule with the `sudo ufw allow ...` command to add it, or a rule present without its managed comment, and you can run `dot firewall` to reconcile. Override the scanned rules file with `DOT_UFW_RULES_FILE`.

After elevation, `dot firewall` re-reads the rules file and fails when any managed rule is still missing or carries a stale comment. That catches silent ufw write failures instead of leaving init marked complete with half-applied rules.

## Daily volume reset (laptop only)

Public dotfiles provide `daily-volume-zero.timer` in laptop-only stow packages (`scripts--laptop` and `systemd--laptop`), a user systemd timer that runs at 5am local time.

- The timer runs `daily-volume-zero`, which sends a 10-second desktop notification, clears default sink mute, then sets the default PipeWire/WirePlumber sink volume to `0%`.
- It is optional and not enabled by `dot`. Enable it on machines that should use it:

```bash
systemctl --user enable --now daily-volume-zero.timer
```
