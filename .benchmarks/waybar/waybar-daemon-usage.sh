#!/usr/bin/env bash

set -euo pipefail

sample_seconds=3
growth_seconds=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--sample)
      sample_seconds="$2"
      shift 2
      ;;
    -g|--growth)
      growth_seconds="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: waybar-daemon-usage.sh [--sample SECONDS] [--growth SECONDS]

  --sample, -s  CPU sample window in seconds (default: 3)
  --growth, -g  Optional watcher growth window in seconds (default: 0)
EOF
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

python - "$sample_seconds" "$growth_seconds" <<'PY'
import collections
import re
import subprocess
import sys
import time

import psutil

sample_seconds = float(sys.argv[1])
growth_seconds = int(float(sys.argv[2]))

patterns = {
    "waybar": re.compile(r"(^|/)waybar(\s|$)"),
    "go-automate bridge serve": re.compile(r"go-automate ha bridge serve"),
    "go-automate bridge watch": re.compile(r"go-automate ha bridge watch entity --waybar"),
    "go-automate watch": re.compile(r"go-automate ha watch entity --waybar"),
    "twitch-notifications": re.compile(r"twitch-notifications"),
    "omarchy-voxtype-status": re.compile(r"omarchy-voxtype-status"),
    "dot-diff-waybar": re.compile(r"dot-diff-waybar\.sh"),
    "github-workflow-failures-waybar": re.compile(r"github-workflow-failures-waybar\.sh"),
}


def get_cmdline(proc):
    try:
        return " ".join(proc.cmdline())
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return ""


def category_for(cmdline):
    for name, pat in patterns.items():
        if pat.search(cmdline):
            return name
    return None


def collect_matching_processes():
    selected = []
    for proc in psutil.process_iter(["pid", "ppid", "cmdline", "memory_info"]):
        cmdline = get_cmdline(proc)
        if not cmdline:
            continue
        category = category_for(cmdline)
        if category:
            selected.append((proc, category, cmdline))
    return selected


def collect_tcp_by_pid():
    out = ""
    try:
        out = subprocess.check_output(["ss", "-tinpH"], text=True, stderr=subprocess.DEVNULL)
    except Exception:
        return {}

    per_pid = collections.defaultdict(lambda: {"conns": 0, "rx": 0, "tx": 0})
    current_pids = []

    for line in out.splitlines():
        if not line.strip():
            continue

        if not line.startswith("\t"):
            current_pids = [int(pid) for _, pid in re.findall(r'\("([^\"]+)",pid=(\d+),fd=\d+\)', line)]
            for pid in current_pids:
                per_pid[pid]["conns"] += 1
            continue

        m_rx = re.search(r"bytes_received:(\d+)", line)
        m_tx = re.search(r"bytes_sent:(\d+)", line)
        rx = int(m_rx.group(1)) if m_rx else 0
        tx = int(m_tx.group(1)) if m_tx else 0
        for pid in current_pids:
            per_pid[pid]["rx"] += rx
            per_pid[pid]["tx"] += tx

    return per_pid


def count_watchers():
    count = 0
    for proc in psutil.process_iter(["cmdline"]):
        try:
            cmdline = " ".join(proc.cmdline())
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        if "go-automate ha watch entity --waybar" in cmdline:
            count += 1
    return count


selected = collect_matching_processes()
for proc, _, _ in selected:
    try:
        proc.cpu_percent(None)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        pass

time.sleep(sample_seconds)

agg = collections.defaultdict(lambda: {"count": 0, "cpu": 0.0, "rss": 0, "examples": []})
for proc, category, cmdline in selected:
    try:
        cpu = proc.cpu_percent(None)
        rss = proc.memory_info().rss
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        continue

    item = agg[category]
    item["count"] += 1
    item["cpu"] += cpu
    item["rss"] += rss
    if len(item["examples"]) < 1:
        item["examples"].append(cmdline)

tcp = collect_tcp_by_pid()
net = collections.defaultdict(lambda: {"conns": 0, "rx": 0, "tx": 0})

for proc, category, _ in selected:
    pid = proc.pid
    if pid not in tcp:
        continue
    net[category]["conns"] += tcp[pid]["conns"]
    net[category]["rx"] += tcp[pid]["rx"]
    net[category]["tx"] += tcp[pid]["tx"]

watch_entities = collections.Counter()
watch_entity_rss = collections.defaultdict(int)
watch_ppid = collections.Counter()

for proc in psutil.process_iter(["pid", "ppid", "cmdline", "memory_info"]):
    try:
        cmdline = " ".join(proc.cmdline())
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        continue
    if "go-automate ha watch entity --waybar" not in cmdline:
        continue

    match = re.search(r"([a-z_]+\.[a-z0-9_]+)$", cmdline)
    entity = match.group(1) if match else "unknown"
    watch_entities[entity] += 1
    watch_ppid[proc.ppid()] += 1
    try:
        watch_entity_rss[entity] += proc.memory_info().rss
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        pass

print(f"CPU sample window: {sample_seconds:.1f}s")
print("CATEGORY\tCOUNT\tCPU%_SUM\tRSS_MB_SUM\tTCP_CONNS\tTCP_RX_MB\tTCP_TX_MB")
for category in sorted(agg.keys()):
    row = agg[category]
    nrow = net[category]
    print(
        f"{category}\t{row['count']}\t{row['cpu']:.1f}\t{row['rss']/1024/1024:.1f}"
        f"\t{nrow['conns']}\t{nrow['rx']/1024/1024:.1f}\t{nrow['tx']/1024/1024:.1f}"
    )

print("\nTOP_WATCH_ENTITIES\tCOUNT\tRSS_MB_SUM")
for entity, count in watch_entities.most_common(10):
    print(f"{entity}\t{count}\t{watch_entity_rss[entity]/1024/1024:.1f}")

print("\nTOP_WATCH_PARENT_PIDS\tCOUNT")
for ppid, count in watch_ppid.most_common(5):
    print(f"{ppid}\t{count}")

if growth_seconds > 0:
    start = count_watchers()
    time.sleep(growth_seconds)
    end = count_watchers()
    delta = end - start
    per_min = delta * (60.0 / growth_seconds)
    print(f"\nWATCHER_GROWTH\twindow_s={growth_seconds}\tstart={start}\tend={end}\tdelta={delta}\test_per_min={per_min:.1f}")
PY

if [[ -x "$HOME/.config/waybar/scripts/camera-usage.sh" ]]; then
  printf '\nCAMERA_USAGE\n'
  "$HOME/.config/waybar/scripts/camera-usage.sh" || true
fi

if [[ -x "$HOME/.config/waybar/scripts/microphone-usage.sh" ]]; then
  printf '\nMICROPHONE_USAGE\n'
  "$HOME/.config/waybar/scripts/microphone-usage.sh" || true
fi
