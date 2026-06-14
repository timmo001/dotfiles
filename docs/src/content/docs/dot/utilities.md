---
title: System Utilities
description: Health checks, benchmarks, and optional timers.
---

## System health check

`system-health-check` is a friendly multi-snapshot system health report covering CPU, memory, network, pressure, and known logs.

```bash
system-health-check                 # write a health report
system-health-check --open-opencode # run opencode run against the report, then open an interactive session
```

Add `--open-opencode` to run `opencode run` against the saved report and then open a full interactive OpenCode session with `opencode --continue`.

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

## Daily volume reset (laptop only)

Public dotfiles provide `daily-volume-zero.timer` in laptop-only stow packages (`scripts--laptop` and `systemd--laptop`), a user systemd timer that runs at 5am local time.

- The timer runs `daily-volume-zero`, which sends a 10-second desktop notification, clears default sink mute, then sets the default PipeWire/WirePlumber sink volume to `0%`.
- It is optional and not enabled by `dot`. Enable it on machines that should use it:

```bash
systemctl --user enable --now daily-volume-zero.timer
```
