#!/usr/bin/env python3

import argparse
import os
import signal
import statistics
import subprocess
import time

import psutil


COMMANDS = [
    {
        "name": "dot-diff-waybar",
        "command": "~/.config/waybar/scripts/dot-diff-waybar.sh",
        "timeout": 10,
        "expects_timeout": False,
    },
    {
        "name": "github-workflow-failures-waybar",
        "command": "~/.config/waybar/scripts/github-workflow-failures-waybar.sh",
        "timeout": 10,
        "expects_timeout": False,
    },
    {
        "name": "twitch-notifications status",
        "command": "twitch-notifications --status-waybar --max-chars 60",
        "timeout": 10,
        "expects_timeout": False,
    },
    {
        "name": "temperature.sh",
        "command": "bash ~/.config/waybar/scripts/temperature.sh",
        "timeout": 10,
        "expects_timeout": False,
    },
    {
        "name": "nas-activity.sh",
        "command": "~/.config/waybar/scripts/nas-activity.sh",
        "timeout": 10,
        "expects_timeout": False,
    },
    {
        "name": "current-next-event.sh",
        "command": "~/.config/waybar/scripts/current-next-event.sh",
        "timeout": 10,
        "expects_timeout": False,
    },
    {
        "name": "co2-alert.sh",
        "command": "~/.config/waybar/scripts/co2-alert.sh",
        "timeout": 10,
        "expects_timeout": False,
    },
    {
        "name": "voc-alert.sh",
        "command": "~/.config/waybar/scripts/voc-alert.sh",
        "timeout": 10,
        "expects_timeout": False,
    },
    {
        "name": "omarchy-update-available",
        "command": "omarchy-update-available",
        "timeout": 10,
        "expects_timeout": False,
    },
    {
        "name": "omarchy-voxtype-status",
        "command": "omarchy-voxtype-status",
        "timeout": 5,
        "expects_timeout": True,
    },
    {
        "name": "bridge watch in_a_call",
        "command": "go-automate ha bridge watch entity --waybar --icon '' --tooltip-on 'In a Call (input_boolean.in_a_call): On' --tooltip-off 'In a Call (input_boolean.in_a_call): Off' --class-on active --class-off inactive --hide-off input_boolean.in_a_call",
        "timeout": 5,
        "expects_timeout": True,
    },
    {
        "name": "bridge watch time_check",
        "command": "go-automate ha bridge watch entity --waybar --icon '' --text-on 'Check the time' --tooltip-on 'Time Check (input_boolean.time_check): On' --tooltip-off 'Time Check (input_boolean.time_check): Off' --class-on active --class-off inactive --hide-off input_boolean.time_check",
        "timeout": 5,
        "expects_timeout": True,
    },
    {
        "name": "bridge watch thermostat_status",
        "command": "go-automate ha bridge watch entity --waybar --icon '' --tooltip-on 'Thermostat Status (sensor.thermostat_status)' sensor.thermostat_status",
        "timeout": 5,
        "expects_timeout": True,
    },
    {
        "name": "bridge watch rain_state",
        "command": "go-automate ha bridge watch entity --waybar --icon '' --tooltip-on 'Weather Station Rain State Piezo (binary_sensor.weather_station_rain_state_piezo): Raining' --tooltip-off 'Weather Station Rain State Piezo (binary_sensor.weather_station_rain_state_piezo): Not raining' --class-on raining --class-off hidden --hide-off binary_sensor.weather_station_rain_state_piezo",
        "timeout": 5,
        "expects_timeout": True,
    },
]


def sample_tree_rss_kb(proc):
    total = 0
    targets = [proc]
    try:
        targets.extend(proc.children(recursive=True))
    except psutil.Error:
        pass

    for child in targets:
        try:
            total += child.memory_info().rss
        except psutil.Error:
            pass

    return total // 1024


def run_once(command, timeout_seconds):
    start = time.perf_counter()
    process = subprocess.Popen(
        ["bash", "-lc", command],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid,
    )

    peak_rss_kb = 0
    timed_out = False

    try:
        proc = psutil.Process(process.pid)
        peak_rss_kb = max(peak_rss_kb, sample_tree_rss_kb(proc))
    except psutil.Error:
        proc = None

    while True:
        if process.poll() is not None:
            break

        if proc is not None:
            peak_rss_kb = max(peak_rss_kb, sample_tree_rss_kb(proc))

        elapsed = time.perf_counter() - start
        if elapsed > timeout_seconds:
            timed_out = True
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
            break

        time.sleep(0.005)

    try:
        process.wait(timeout=0.2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=0.2)

    elapsed = time.perf_counter() - start
    return {
        "elapsed": elapsed,
        "peak_rss_kb": peak_rss_kb,
        "timed_out": timed_out,
        "returncode": process.returncode,
    }


def p95(values):
    ordered = sorted(values)
    idx = round(0.95 * (len(ordered) - 1))
    return ordered[idx]


def main():
    parser = argparse.ArgumentParser(description="Benchmark Waybar module commands")
    parser.add_argument("--runs", type=int, default=3, help="Runs per command")
    parser.add_argument(
        "--include-stream",
        action="store_true",
        help="Include long-running stream commands that are expected to time out",
    )
    args = parser.parse_args()

    if args.runs < 1:
        raise SystemExit("--runs must be >= 1")

    commands = []
    for item in COMMANDS:
        if item["expects_timeout"] and not args.include_stream:
            continue
        commands.append(item)

    print(
        "COMMAND\tRUNS\tMEDIAN_SEC\tP95_SEC\t"
        "MEDIAN_PEAK_RSS_KB\tTIMEOUTS\tNONZERO\tEXPECTS_TIMEOUT"
    )

    for item in commands:
        results = [run_once(item["command"], item["timeout"]) for _ in range(args.runs)]
        elapsed = [r["elapsed"] for r in results]
        rss = [r["peak_rss_kb"] for r in results]
        timeouts = sum(1 for r in results if r["timed_out"])
        nonzero = sum(1 for r in results if r["returncode"] not in (0, None))

        print(
            f"{item['name']}\t{args.runs}\t{statistics.median(elapsed):.3f}\t{p95(elapsed):.3f}"
            f"\t{int(statistics.median(rss))}\t{timeouts}\t{nonzero}\t{str(item['expects_timeout']).lower()}"
        )


if __name__ == "__main__":
    main()
