---
title: System Utilities
description: Health checks, system updates, benchmarks, and optional timers.
---

## System health check

`system-health-check` is a friendly multi-snapshot system health report covering CPU, memory, network, pressure, and known logs.

```bash
system-health-check                 # write a health report
system-health-check --open-opencode # run opencode run against the report, then open an interactive session
```

Add `--open-opencode` to run `opencode run` against the saved report and then open a full interactive OpenCode session with `opencode --continue`.

## System updates

[topgrade](https://github.com/topgrade-rs/topgrade) runs the machine's update steps (AUR via `yay`, Flatpak, firmware checks, `mise` tools, `rustup`, `cargo`, and more) in one pass. The repo stows a tuned config to `~/.config/topgrade.toml` and a logging wrapper at `scripts/.local/bin/topgrade` that shadows the system binary via `~/.local/bin` on `PATH`.

```bash
topgrade            # full run (all enabled steps)
topgrade mise cargo # run only named steps
```

- The wrapper logs the full session to `$XDG_STATE_HOME/topgrade.log` (default `~/.local/state/topgrade.log`) with `script`, mirroring the `omarchy-update` pattern, so you can review a run afterwards.
- It adds `--sudoloop` automatically when a run includes steps that need root (a full run, or the `system`, `firmware`, or `containers` steps) so credentials stay cached during long runs, and skips it for user-only steps.
- `omarchy update -y` runs as a post-command in place of topgrade's built-in `system` step (which is disabled), so Omarchy and OS packages update through Omarchy's own flow.
- Firmware is check-only, `mise` bumps tool versions, and `yay` runs with `--noconfirm --cleanafter`.
- Steps managed elsewhere or unused are disabled (for example `bun`, `deno`, `go`, and `pnpm` come from `mise`; `hyprpm` is skipped because it drops the shared sudo credential and would force `omarchy update` to re-authenticate). A desktop notification fires only on failure.

## Benchmarks and tests

The repo includes minimal system-wide benchmark and resource-leak test scripts under `.benchmarks/` and `.tests/` (excluded from stow):

- `.benchmarks/system-quick-bench.sh` — short CPU/memory/network benchmark snapshot.
- `.tests/system-resource-leak-test.sh` — short leak and growth check over time.

```bash
# Quick benchmark (minimal defaults)
.benchmarks/system-quick-bench.sh

# Include LAN throughput (requires an iperf3 target)
.benchmarks/system-quick-bench.sh --iperf-host 192.168.1.50

# Resource leak test (short run)
.tests/system-resource-leak-test.sh
```

- Benchmarks write outputs to `.benchmarks/output/`; tests write to `.tests/output/` (both gitignored).
- LAN network throughput is opt-in and requires `--iperf-host`.
- Scripts use ANSI colour output by default; set `NO_COLOR=1` to disable.
- All scripts include an uptime/load snapshot near the top of output.

## Firewall rules

`dot init` configures a managed set of [ufw](https://wiki.archlinux.org/title/Uncomplicated_Firewall) rules, and `dot doctor` verifies they are still present. The setup reads the world-readable ufw rules file first, so a fully configured machine adds nothing and never prompts for a password; only missing rules are added, followed by a single `ufw reload`. Each rule is tagged with its purpose as a ufw comment, so it appears in `ufw status`.

Most rules are inbound port allows on any interface. The libvirt rules are scoped to the `virbr0` bridge: two inbound allows for guest DHCP and DNS, plus a forwarding (route) allow so the default NAT network can route guest traffic off the bridge. Without them, ufw's default `deny (incoming)` and `deny (routed)` policy leaves guests without an address or internet access.

| Port(s) | Protocol | Scope | Purpose |
| --- | --- | --- | --- |
| `1714:1764` | UDP + TCP | any | KDE Connect device discovery and transfer. |
| `8123` | TCP | any | Home Assistant frontend. |
| `8124` | TCP | any | Home Assistant companion port. |
| `4096` | TCP | any | dot OpenCode server. |
| `53317` | UDP + TCP | any | LocalSend device discovery and transfer. |
| `67` | UDP | `virbr0` | libvirt guest DHCP. |
| `53` | TCP + UDP | `virbr0` | libvirt guest DNS. |
| forward | any | `virbr0` | libvirt NAT: forward guest traffic off the bridge. |

If `ufw` is not installed, both init and doctor skip the firewall step with a warning. The doctor check reports any missing rule with the `sudo ufw allow ...` command to add it, or a rule present without its managed comment, and you can re-run `dot init` to reconcile. Override the scanned rules file with `DOT_UFW_RULES_FILE`.

## Daily volume reset (laptop only)

Public dotfiles provide `daily-volume-zero.timer` in laptop-only stow packages (`scripts--laptop` and `systemd--laptop`), a user systemd timer that runs at 5am local time.

- The timer runs `daily-volume-zero`, which sends a 10-second desktop notification, clears default sink mute, then sets the default PipeWire/WirePlumber sink volume to `0%`.
- It is optional and not enabled by `dot`. Enable it on machines that should use it:

```bash
systemctl --user enable --now daily-volume-zero.timer
```
