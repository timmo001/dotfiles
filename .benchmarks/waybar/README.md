# Waybar Benchmark Toolkit

Saved benchmark utilities for this repository's Waybar setup.

This directory is intentionally hidden (`.benchmarks/...`) so it is not picked up as a top-level stow package by `dot stow`.

## Scripts

- `waybar-daemon-usage.sh`: snapshot daemon/process CPU, memory, and TCP usage.
- `waybar-command-bench.py`: benchmark module command runtimes and peak memory.

## Usage

```bash
# Daemon/process snapshot (3s CPU sample)
.benchmarks/waybar/waybar-daemon-usage.sh

# Include watcher growth check over 20s
.benchmarks/waybar/waybar-daemon-usage.sh --growth 20

# Command-level benchmark (3 runs each)
.benchmarks/waybar/waybar-command-bench.py

# Command-level benchmark with more runs
.benchmarks/waybar/waybar-command-bench.py --runs 5
```

## Notes

See `CHANGE_NOTES.md` for baseline findings and where changes are likely needed.
