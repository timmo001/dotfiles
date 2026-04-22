# System Tests and Benchmarks

Minimal system-wide benchmarks and diagnostics (not Waybar-specific).

## Scripts

- `.benchmarks/system-quick-bench.sh`: short CPU/memory/network benchmark snapshot.
- `.tests/system-resource-leak-test.sh`: short leak and growth check over time.
- `.tests/browser-freeze-snapshot.sh`: lightweight Chromium/Chrome freeze evidence snapshot.

## Output layout

- Benchmarks write outputs to `.benchmarks/output/`.
- Tests write outputs to `.tests/output/`.

## Usage

```bash
# Quick benchmark (minimal defaults)
.benchmarks/system-quick-bench.sh

# Include LAN throughput (requires iperf3 target)
.benchmarks/system-quick-bench.sh --iperf-host 192.168.1.50

# Resource leak test (short run)
.tests/system-resource-leak-test.sh

# Browser freeze snapshot (single run)
.tests/browser-freeze-snapshot.sh
```

## Notes

- LAN network throughput is opt-in and requires `--iperf-host`.
- Scripts use ANSI color output by default; set `NO_COLOR=1` to disable.
- Browser freeze monitor is opt-in via systemd timer:
  - `systemctl --user enable --now browser-freeze-snapshot.timer`
  - `systemctl --user disable --now browser-freeze-snapshot.timer`
