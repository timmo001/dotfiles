#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"

OUTPUT_FILE=""
JOURNAL_MINUTES=10
TOP_PROCS=20

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

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

usage() {
  cat <<'EOF'
Usage: browser-freeze-snapshot.sh [options]

Options:
  --journal-minutes <n>     Minutes of journal history to include (default: 10)
  --top-procs <n>           Number of top browser processes by RSS (default: 20)
  --output <path>           Output file path
  --help                    Show this help
EOF
}

validate_positive_int() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1 )); then
    printf 'browser-freeze-snapshot.sh: %s must be a positive integer\n' "$name" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --journal-minutes)
      JOURNAL_MINUTES="$2"
      shift 2
      ;;
    --top-procs)
      TOP_PROCS="$2"
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
      printf 'browser-freeze-snapshot.sh: unknown argument: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

validate_positive_int '--journal-minutes' "$JOURNAL_MINUTES"
validate_positive_int '--top-procs' "$TOP_PROCS"

if [[ -z "$OUTPUT_FILE" ]]; then
  mkdir -p "$OUTPUT_DIR"
  OUTPUT_FILE="$OUTPUT_DIR/browser-freeze-snapshot-$(date +%Y%m%d-%H%M%S).txt"
else
  mkdir -p "$(dirname "$OUTPUT_FILE")"
fi

exec > >(tee "$OUTPUT_FILE") 2>&1

style_line "${C_BOLD}${C_CYAN}" 'Browser freeze snapshot'
printf 'Timestamp: %s\n' "$(date -Is)"
printf 'Host: %s\n' "$(hostname)"
printf 'Uptime/load: '
uptime

style_line "${C_BOLD}${C_BLUE}" 'Browser process summary'
if has_cmd pgrep; then
  pgrep -af '(^|/)(chromium|google-chrome|chrome)($| )' || style_line "$C_YELLOW" 'No Chromium/Chrome processes found.'
else
  style_line "$C_RED" 'pgrep not found; cannot inspect browser processes.'
fi

style_line "${C_BOLD}${C_BLUE}" "Top ${TOP_PROCS} browser processes by RSS"
ps -eo pid=,ppid=,pcpu=,rss=,args= \
  | awk '/chromium|google-chrome|chrome/ {printf "%s\t%s\t%s\t%s\t%s\n", $1, $2, $3, $4, substr($0, index($0,$5))}' \
  | sort -t$'\t' -k4,4nr \
  | head -n "$TOP_PROCS" \
  | awk -F'\t' '{ printf "pid=%s ppid=%s cpu=%s rss_mb=%.1f cmd=%s\n", $1, $2, $3, $4/1024.0, $5 }'

style_line "${C_BOLD}${C_BLUE}" 'Browser memory summary'
if has_cmd ps; then
  browser_summary="$(ps -eo rss=,args= | awk '/chromium|google-chrome|chrome/ {count+=1; sum+=$1} END {printf "%d %d", count, sum}')"
  browser_count="${browser_summary%% *}"
  total_browser_rss_kb="${browser_summary##* }"
  printf 'Browser process count: %s\n' "$browser_count"
  awk -v kb="$total_browser_rss_kb" 'BEGIN { printf "Total browser RSS: %.1f MB\n", kb / 1024.0 }'
else
  style_line "$C_YELLOW" 'ps unavailable; skipping browser memory summary.'
fi

style_line "${C_BOLD}${C_BLUE}" 'Top 3 renderer processes by RSS'
renderer_lines="$(ps -eo pid=,pcpu=,rss=,args= \
  | awk '/chromium|google-chrome|chrome/ && /--type=renderer/ {printf "%s\tpid=%s cpu=%s rss_mb=%.1f cmd=%s\n", $3, $1, $2, $3/1024.0, substr($0, index($0,$4))}' \
  | sort -t$'\t' -k1,1nr \
  | head -n 3 \
  | awk -F'\t' '{print $2}')"
if [[ -n "$renderer_lines" ]]; then
  printf '%s\n' "$renderer_lines"
else
  style_line "$C_YELLOW" 'No renderer processes found in current snapshot.'
fi

style_line "${C_BOLD}${C_BLUE}" 'Pressure and sockets snapshot'
printf '/proc/pressure/cpu\n'
cat /proc/pressure/cpu
printf '/proc/pressure/memory\n'
cat /proc/pressure/memory
printf '/proc/pressure/io\n'
cat /proc/pressure/io
if has_cmd ss; then
  printf '\nSocket summary:\n'
  ss -s
fi

style_line "${C_BOLD}${C_BLUE}" 'GPU and browser journal signals'
if has_cmd journalctl; then
  journalctl --user --since "${JOURNAL_MINUTES} minutes ago" --no-pager -o cat \
    | grep -Ei 'chrom|chrome|gpu|hang|freeze|crash|segfault|viz|skia|sandbox|device lost|context lost|oom|watchdog|amdgpu|drm' || true

  printf '\nTop repeated user-journal signals:\n'
  journalctl --user --since "${JOURNAL_MINUTES} minutes ago" --no-pager -o cat \
    | grep -Ei 'error|failed|crash|segfault|hang|freeze|oom|watchdog|gpu|drm|amdgpu|chrom|chrome' \
    | sed -E 's/^([A-Z][a-z]{2} [[:space:]][0-9]{1,2} [0-9]{2}:[0-9]{2}:[0-9]{2} [^:]+ [^:]+: )+//' \
    | sort \
    | uniq -c \
    | sort -nr \
    | head -n 20 || true
else
  style_line "$C_YELLOW" 'journalctl not available in user session.'
fi

if has_cmd journalctl; then
  printf '\nKernel signals:\n'
  journalctl -k --since "${JOURNAL_MINUTES} minutes ago" --no-pager \
    | grep -Ei 'oom|out of memory|amdgpu|nvidia|drm|gpu hang|segfault|watchdog' || true
fi

style_line "${C_BOLD}${C_GREEN}" 'Snapshot complete'
printf 'Saved snapshot output: %s\n' "$OUTPUT_FILE"
