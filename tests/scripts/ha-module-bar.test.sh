#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
module="$repo_root/scripts/.local/bin/ha-module-bar"
test_root=$(mktemp -d)
mock_bin="$test_root/bin"
mkdir -p "$mock_bin"
trap 'rm -rf "$test_root"' EXIT

cat >"$mock_bin/go-automate" <<'EOF'
#!/bin/bash
printf '{"text":"%s °C","tooltip":"%s °C","class":"%s"}\n' "$HA_TEST_STATE" "$HA_TEST_STATE" "$HA_TEST_STATE"
EOF
chmod +x "$mock_bin/go-automate"

run_temperature() {
  HA_TEST_STATE="$1" PATH="$mock_bin:$PATH" "$module" temperature --show-above 25
}

[[ $(run_temperature 24.9) == '{"text":"","class":"hidden"}' ]]
[[ $(run_temperature 25) == '{"text":"","class":"hidden"}' ]]
[[ $(run_temperature 25.1 | jq -r .text) == '25.1' ]]
[[ $(run_temperature -2.5) == '{"text":"","class":"hidden"}' ]]
[[ $(run_temperature unavailable) == '{"text":"","class":"hidden"}' ]]
[[ $(run_temperature malformed) == '{"text":"","class":"hidden"}' ]]

without_threshold=$(HA_TEST_STATE=-2.5 PATH="$mock_bin:$PATH" "$module" temperature)
[[ $(jq -r .text <<<"$without_threshold") == '-2.5' ]]

icon_only=$(HA_TEST_STATE=30.7 PATH="$mock_bin:$PATH" "$module" temperature --icon 󰖙 --icon-only)
[[ $(jq -r .text <<<"$icon_only") == '󰖙' ]]
[[ $(jq -r .tooltip <<<"$icon_only") == *'30.7 °C' ]]

co2_warning=$(PATH="$mock_bin:$PATH" "$module" co2-alert --fake-state warning)
[[ $(jq -r .text <<<"$co2_warning") == '󰟤 1600' ]]
[[ $(jq -r .tooltip <<<"$co2_warning") == *'1600 ppm' ]]

voc_warning=$(PATH="$mock_bin:$PATH" "$module" voc-alert --fake-state warning)
[[ $(jq -r .text <<<"$voc_warning") == '󰵃 240' ]]
[[ $(jq -r .class <<<"$voc_warning") == 'warning' ]]
[[ $(jq -r .tooltip <<<"$voc_warning") == $'Apollo Air 1 VOC (sensor.apollo_air_1_806d64_sen55_voc): 240\nVOC Quality (sensor.apollo_air_1_806d64_voc_quality): Very abnormal' ]]

voc_critical=$(PATH="$mock_bin:$PATH" "$module" voc-alert --fake-state critical)
[[ $(jq -r .class <<<"$voc_critical") == 'critical' ]]

if PATH="$mock_bin:$PATH" "$module" temperature --show-above nope >"$test_root/output" 2>&1; then
  exit 1
fi
grep -q -- '--show-above must be a number' "$test_root/output"

printf 'ha-module-bar temperature threshold tests passed\n'
