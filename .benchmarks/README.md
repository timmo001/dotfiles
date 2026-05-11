# System Tests and Benchmarks

Minimal system-wide benchmarks and diagnostics (not Waybar-specific).

## Scripts

- `.benchmarks/system-quick-bench.sh`: short CPU/memory/network benchmark snapshot.
- `.tests/system-resource-leak-test.sh`: short leak and growth check over time.

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
```

## Notes

- LAN network throughput is opt-in and requires `--iperf-host`.
- Scripts use ANSI color output by default; set `NO_COLOR=1` to disable.
- All scripts include an uptime/load snapshot near the top of output.
