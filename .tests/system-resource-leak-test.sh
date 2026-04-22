#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"

OUTPUT_FILE=""
DURATION=120
INTERVAL=5
WARMUP=20

RSS_GROWTH_MB=300
SWAP_GROWTH_MB=256
PRESSURE_GROWTH_TENTHS=20
SOCKET_GROWTH=200

C_RESET=$'\033[0m'
C_BOLD=$'\033[1m'
C_RED=$'\033[31m'
C_GREEN=$'\033[32m'
C_YELLOW=$'\033[33m'
C_BLUE=$'\033[34m'
C_CYAN=$'\033[36m'

if [[ -n "${NO_COLOR:-}" ]] || { [[ ! -t 1 ]] && [[ -z "${FORCE_COLOR:-}" ]]; }; then
  C_RESET=''
  C_BOLD=''
  C_RED=''
  C_GREEN=''
  C_YELLOW=''
  C_BLUE=''
  C_CYAN=''
fi

style_line() {
  local color="$1"
  shift
  printf '%b%s%b\n' "$color" "$*" "$C_RESET"
}

usage() {
  cat <<'EOF'
Usage: system-resource-leak-test.sh [options]

Options:
  --duration <seconds>             Total sampling duration (default: 120)
  --interval <seconds>             Seconds between samples (default: 5)
  --warmup <seconds>               Warmup before baseline capture (default: 20)
  --rss-growth-mb <n>              Allowed RSS growth in MB (default: 300)
  --swap-growth-mb <n>             Allowed swap growth in MB (default: 256)
  --pressure-growth-tenths <n>     Allowed PSI growth in tenths (default: 20 => 2.0)
  --socket-growth <n>              Allowed socket count growth (default: 200)
  --output <path>                  Output file path
  --help                           Show this help
EOF
}

validate_non_negative_int() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    printf 'system-resource-leak-test.sh: %s must be a non-negative integer\n' "$name" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration)
      DURATION="$2"
      shift 2
      ;;
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    --warmup)
      WARMUP="$2"
      shift 2
      ;;
    --rss-growth-mb)
      RSS_GROWTH_MB="$2"
      shift 2
      ;;
    --swap-growth-mb)
      SWAP_GROWTH_MB="$2"
      shift 2
      ;;
    --pressure-growth-tenths)
      PRESSURE_GROWTH_TENTHS="$2"
      shift 2
      ;;
    --socket-growth)
      SOCKET_GROWTH="$2"
      shift 2
      ;;
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'system-resource-leak-test.sh: unknown argument: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

validate_non_negative_int '--duration' "$DURATION"
validate_non_negative_int '--interval' "$INTERVAL"
validate_non_negative_int '--warmup' "$WARMUP"
validate_non_negative_int '--rss-growth-mb' "$RSS_GROWTH_MB"
validate_non_negative_int '--swap-growth-mb' "$SWAP_GROWTH_MB"
validate_non_negative_int '--pressure-growth-tenths' "$PRESSURE_GROWTH_TENTHS"
validate_non_negative_int '--socket-growth' "$SOCKET_GROWTH"

if (( DURATION < 1 )); then
  printf 'system-resource-leak-test.sh: --duration must be >= 1\n' >&2
  exit 1
fi

if (( INTERVAL < 1 )); then
  printf 'system-resource-leak-test.sh: --interval must be >= 1\n' >&2
  exit 1
fi

if [[ -z "$OUTPUT_FILE" ]]; then
  mkdir -p "$OUTPUT_DIR"
  OUTPUT_FILE="$OUTPUT_DIR/system-resource-leak-test-$(date +%Y%m%d-%H%M%S).txt"
else
  mkdir -p "$(dirname "$OUTPUT_FILE")"
fi

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

read_mem_available_kb() {
  awk '/MemAvailable:/ { print $2 }' /proc/meminfo
}

read_swap_used_kb() {
  awk '/SwapTotal:/ { total=$2 } /SwapFree:/ { free=$2 } END { print total - free }' /proc/meminfo
}

read_pressure_tenths() {
  local file="$1"
  awk '/^some / { for (i=1; i<=NF; i++) if ($i ~ /^avg60=/) { split($i, a, "="); printf "%.0f", a[2] * 10; exit } }' "$file"
}

read_socket_count() {
  if ! has_cmd ss; then
    printf '0'
    return
  fi

  ss -s | awk '/TCP:/ { print $2; exit }' | tr -dc '0-9'
}

format_mb_from_kb() {
  local kb="$1"
  awk -v v="$kb" 'BEGIN { printf "%.1f", v / 1024.0 }'
}

format_tenths() {
  local t="$1"
  awk -v v="$t" 'BEGIN { printf "%.1f", v / 10.0 }'
}

exec > >(tee "$OUTPUT_FILE") 2>&1

style_line "${C_BOLD}${C_CYAN}" 'System resource leak test'
printf 'Duration: %ss\n' "$DURATION"
printf 'Interval: %ss\n' "$INTERVAL"
printf 'Warmup: %ss\n' "$WARMUP"

style_line "$C_YELLOW" 'Warmup phase'
sleep "$WARMUP"

baseline_rss_kb="$(read_mem_available_kb)"
baseline_swap_kb="$(read_swap_used_kb)"
baseline_cpu_pressure_tenths="$(read_pressure_tenths /proc/pressure/cpu)"
baseline_mem_pressure_tenths="$(read_pressure_tenths /proc/pressure/memory)"
baseline_io_pressure_tenths="$(read_pressure_tenths /proc/pressure/io)"
baseline_sockets="$(read_socket_count)"

style_line "${C_BOLD}${C_BLUE}" 'Baseline'
printf 'MemAvailable: %s MB\n' "$(format_mb_from_kb "$baseline_rss_kb")"
printf 'SwapUsed: %s MB\n' "$(format_mb_from_kb "$baseline_swap_kb")"
printf 'CPU pressure avg60: %s\n' "$(format_tenths "$baseline_cpu_pressure_tenths")"
printf 'Memory pressure avg60: %s\n' "$(format_tenths "$baseline_mem_pressure_tenths")"
printf 'IO pressure avg60: %s\n' "$(format_tenths "$baseline_io_pressure_tenths")"
printf 'TCP sockets: %s\n' "$baseline_sockets"

total_samples=$(((DURATION + INTERVAL - 1) / INTERVAL))
style_line "$C_YELLOW" 'Sampling phase'
for ((i = 1; i <= total_samples; i += 1)); do
  current_rss_kb="$(read_mem_available_kb)"
  current_swap_kb="$(read_swap_used_kb)"
  current_cpu_pressure_tenths="$(read_pressure_tenths /proc/pressure/cpu)"
  current_mem_pressure_tenths="$(read_pressure_tenths /proc/pressure/memory)"
  current_io_pressure_tenths="$(read_pressure_tenths /proc/pressure/io)"
  current_sockets="$(read_socket_count)"

  printf 'sample %02d/%02d: mem_avail=%sMB swap=%sMB cpu_psi60=%s mem_psi60=%s io_psi60=%s tcp=%s\n' \
    "$i" "$total_samples" \
    "$(format_mb_from_kb "$current_rss_kb")" \
    "$(format_mb_from_kb "$current_swap_kb")" \
    "$(format_tenths "$current_cpu_pressure_tenths")" \
    "$(format_tenths "$current_mem_pressure_tenths")" \
    "$(format_tenths "$current_io_pressure_tenths")" \
    "$current_sockets"

  if (( i < total_samples )); then
    sleep "$INTERVAL"
  fi
done

final_rss_kb="$(read_mem_available_kb)"
final_swap_kb="$(read_swap_used_kb)"
final_cpu_pressure_tenths="$(read_pressure_tenths /proc/pressure/cpu)"
final_mem_pressure_tenths="$(read_pressure_tenths /proc/pressure/memory)"
final_io_pressure_tenths="$(read_pressure_tenths /proc/pressure/io)"
final_sockets="$(read_socket_count)"

rss_drop_kb=$((baseline_rss_kb - final_rss_kb))
swap_growth_kb=$((final_swap_kb - baseline_swap_kb))
cpu_pressure_growth=$((final_cpu_pressure_tenths - baseline_cpu_pressure_tenths))
mem_pressure_growth=$((final_mem_pressure_tenths - baseline_mem_pressure_tenths))
io_pressure_growth=$((final_io_pressure_tenths - baseline_io_pressure_tenths))
socket_growth=$((final_sockets - baseline_sockets))

rss_growth_threshold_kb=$((RSS_GROWTH_MB * 1024))
swap_growth_threshold_kb=$((SWAP_GROWTH_MB * 1024))

fail=0
declare -a failures=()

if (( rss_drop_kb > rss_growth_threshold_kb )); then
  fail=1
  failures+=("MemAvailable dropped by $(format_mb_from_kb "$rss_drop_kb") MB (threshold ${RSS_GROWTH_MB} MB)")
fi

if (( swap_growth_kb > swap_growth_threshold_kb )); then
  fail=1
  failures+=("Swap used grew by $(format_mb_from_kb "$swap_growth_kb") MB (threshold ${SWAP_GROWTH_MB} MB)")
fi

if (( cpu_pressure_growth > PRESSURE_GROWTH_TENTHS )); then
  fail=1
  failures+=("CPU pressure avg60 grew by $(format_tenths "$cpu_pressure_growth") (threshold $(format_tenths "$PRESSURE_GROWTH_TENTHS"))")
fi

if (( mem_pressure_growth > PRESSURE_GROWTH_TENTHS )); then
  fail=1
  failures+=("Memory pressure avg60 grew by $(format_tenths "$mem_pressure_growth") (threshold $(format_tenths "$PRESSURE_GROWTH_TENTHS"))")
fi

if (( io_pressure_growth > PRESSURE_GROWTH_TENTHS )); then
  fail=1
  failures+=("IO pressure avg60 grew by $(format_tenths "$io_pressure_growth") (threshold $(format_tenths "$PRESSURE_GROWTH_TENTHS"))")
fi

if (( socket_growth > SOCKET_GROWTH )); then
  fail=1
  failures+=("TCP sockets grew by $socket_growth (threshold $SOCKET_GROWTH)")
fi

style_line "${C_BOLD}${C_BLUE}" 'Summary'
printf 'MemAvailable delta: -%s MB\n' "$(format_mb_from_kb "$rss_drop_kb")"
printf 'SwapUsed delta: +%s MB\n' "$(format_mb_from_kb "$swap_growth_kb")"
printf 'CPU PSI avg60 delta: +%s\n' "$(format_tenths "$cpu_pressure_growth")"
printf 'Memory PSI avg60 delta: +%s\n' "$(format_tenths "$mem_pressure_growth")"
printf 'IO PSI avg60 delta: +%s\n' "$(format_tenths "$io_pressure_growth")"
printf 'TCP socket delta: +%s\n' "$socket_growth"

if (( fail )); then
  style_line "${C_BOLD}${C_RED}" 'Result: FAIL'
  printf 'Failures:\n'
  for failure in "${failures[@]}"; do
    printf -- '- %s\n' "$failure"
  done
  printf '\nSaved test output: %s\n' "$OUTPUT_FILE"
  exit 1
fi

style_line "${C_BOLD}${C_GREEN}" 'Result: PASS'
printf 'No thresholds exceeded.\n'
printf '\nSaved test output: %s\n' "$OUTPUT_FILE"
