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
entity="${*: -1}"
state="$HA_TEST_STATE"
if [[ "$entity" == climate.* ]]; then state="${HA_TEST_CLIMATE_STATE:-$state}"; fi
if [[ "$entity" == input_boolean.* ]]; then state="${HA_TEST_BOOLEAN_STATE:-$state}"; fi
printf '{"text":"%s °C","tooltip":"%s °C","class":"%s"}\n' "$state" "$state" "$state"
EOF
chmod +x "$mock_bin/go-automate"

run_temperature() {
  HA_TEST_STATE="$1" PATH="$mock_bin:$PATH" "$module" temperature --show-above 25
}

[[ $(run_temperature 24.9) == '{"text":"24.9","class":"hidden","tooltip":"Meter Plus Temperature (sensor.meter_plus_378b_temperature): 24.9 °C"}' ]]
[[ $(run_temperature 25) == '{"text":"25","class":"hidden","tooltip":"Meter Plus Temperature (sensor.meter_plus_378b_temperature): 25 °C"}' ]]
[[ $(run_temperature 25.125 | jq -r .text) == '25.125' ]]
[[ $(run_temperature 25.1 | jq -r .text) == '25.1' ]]
[[ $(run_temperature -2.5 | jq -r .text) == '-2.5' ]]
[[ $(run_temperature unavailable) == '{"text":"","class":"hidden"}' ]]
[[ $(run_temperature malformed) == '{"text":"","class":"hidden"}' ]]

without_threshold=$(HA_TEST_STATE=-2.5 PATH="$mock_bin:$PATH" "$module" temperature)
[[ $(jq -r .text <<<"$without_threshold") == '-2.5' ]]

icon_only=$(HA_TEST_STATE=30.7 PATH="$mock_bin:$PATH" "$module" temperature --icon 󰖙 --icon-only)
[[ $(jq -r .text <<<"$icon_only") == '󰖙' ]]
[[ $(jq -r .tooltip <<<"$icon_only") == *'30.7 °C' ]]

ac_target_unavailable=$(HA_TEST_STATE=24 HA_TEST_CLIMATE_STATE=unavailable PATH="$mock_bin:$PATH" "$module" dining-temperature --entity input_number.living_room_air_conditioner_target_temperature --gate-entity input_number.living_room_air_conditioner_target_temperature --gate-below 26 --status-entity climate.air_conditioner --active-state cool)
[[ $ac_target_unavailable == '{"text":"","class":"hidden"}' ]]

ac_target_available=$(HA_TEST_STATE=24.25 HA_TEST_CLIMATE_STATE=cool PATH="$mock_bin:$PATH" "$module" dining-temperature --entity input_number.living_room_air_conditioner_target_temperature --gate-entity input_number.living_room_air_conditioner_target_temperature --gate-below 26 --status-entity climate.air_conditioner --active-state cool)
[[ $(jq -r .text <<<"$ac_target_available") == '24.25' ]]
[[ $(jq -r .class <<<"$ac_target_available") == 'active' ]]

office_target=$(HA_TEST_STATE=23 HA_TEST_BOOLEAN_STATE=on HA_TEST_CLIMATE_STATE=off PATH="$mock_bin:$PATH" "$module" dining-temperature --entity input_number.office_air_conditioner_target_temperature --gate-entity input_boolean.office_air_conditioner_enabled --gate-state on --status-entity climate.office_air_conditioner --active-state cool)
[[ $(jq -r .text <<<"$office_target") == '23' ]]
[[ $(jq -r .class <<<"$office_target") == 'temperature' ]]

office_target_disabled=$(HA_TEST_STATE=23 HA_TEST_BOOLEAN_STATE=off HA_TEST_CLIMATE_STATE=cool PATH="$mock_bin:$PATH" "$module" dining-temperature --entity input_number.office_air_conditioner_target_temperature --gate-entity input_boolean.office_air_conditioner_enabled --gate-state on --status-entity climate.office_air_conditioner --active-state cool)
[[ $office_target_disabled == '{"text":"","class":"hidden"}' ]]

co2_healthy=$(HA_TEST_STATE=800.75 PATH="$mock_bin:$PATH" "$module" co2-alert)
[[ $(jq -r .text <<<"$co2_healthy") == '󰟤 800.75' ]]
[[ $(jq -r .class <<<"$co2_healthy") == 'hidden' ]]
[[ $(jq -r .tooltip <<<"$co2_healthy") == *'800.75 ppm' ]]

co2_warning=$(PATH="$mock_bin:$PATH" "$module" co2-alert --fake-state warning)
[[ $(jq -r .text <<<"$co2_warning") == '󰟤 1600' ]]
[[ $(jq -r .tooltip <<<"$co2_warning") == *'1600 ppm' ]]

voc_warning=$(PATH="$mock_bin:$PATH" "$module" voc-alert --fake-state warning)
[[ $(jq -r .text <<<"$voc_warning") == '󰵃 240' ]]
[[ $(jq -r .class <<<"$voc_warning") == 'warning' ]]
[[ $(jq -r .tooltip <<<"$voc_warning") == $'Apollo Air 1 VOC (sensor.apollo_air_1_806d64_sen55_voc): 240\nVOC Quality (sensor.apollo_air_1_806d64_voc_quality): Very abnormal' ]]

voc_critical=$(PATH="$mock_bin:$PATH" "$module" voc-alert --fake-state critical)
[[ $(jq -r .class <<<"$voc_critical") == 'critical' ]]

voc_decimal=$(HA_TEST_STATE=240.625 PATH="$mock_bin:$PATH" "$module" voc-alert)
[[ $(jq -r .text <<<"$voc_decimal") == '󰵃 240.625' ]]
[[ $(jq -r .tooltip <<<"$voc_decimal") == *': 240.625'* ]]

if PATH="$mock_bin:$PATH" "$module" temperature --show-above nope >"$test_root/output" 2>&1; then
  exit 1
fi
grep -q -- '--show-above must be a number' "$test_root/output"

printf 'ha-module-bar temperature threshold tests passed\n'
