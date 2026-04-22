# Waybar Benchmark Change Notes

## Why these changes were needed

- Interval scripts were spawning `go-automate ha bridge watch entity --waybar` repeatedly.
- Process snapshots showed a large accumulation of watcher processes over time.
- Machine-consumed output paths were mixed between plain text and Waybar JSON expectations.

## High-priority change targets

- `/home/aidan/.config/waybar/scripts/temperature.sh`
- `/home/aidan/.config/waybar/scripts/co2-alert.sh`
- `/home/aidan/.config/waybar/scripts/current-next-event.sh`
- `/home/aidan/.config/waybar/scripts/voc-alert.sh`
- `/home/aidan/.config/waybar/scripts/nas-activity.sh`
- `/home/aidan/.config/waybar/scripts/doorbell.sh`

## Required policy for future edits

- Prefer `go-automate ha bridge watch entity` over `go-automate ha watch entity`.
- Prefer `--waybar` JSON output for script/bar consumers.
- For interval-driven scripts, prefer `ha-watch-singleton` / `singleton-stream` where feasible.

## Validation checklist

- Run `.benchmarks/waybar/waybar-command-bench.py --runs 3`.
- Run `.benchmarks/waybar/waybar-daemon-usage.sh --growth 20`.
- Confirm watcher count growth is stable/near-zero after restart of Waybar/user services.

## Stow note

- This benchmark toolkit is stored under `.benchmarks/` so it is not included as a stow package by `dot stow`.
