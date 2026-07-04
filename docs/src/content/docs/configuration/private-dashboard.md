---
title: Private Dashboard Config
description: The dot-dashboard.yml schema for optional dashboard source cards.
sidebar:
  order: 4
---

`dot dashboard` reads an optional private YAML file that wires bounded external commands into dashboard cards. It lives in the private overlay at `$DOTFILES_PRIVATE_DIR/dot-dashboard.yml` by default.

Without this file, the dashboard still shows git diff, notifications, workflow, and update cards from in-process services. The optional `sources` block adds Twitch, environment, calendar, and todo cards when commands are configured.

## Schema

The file has a top-level `sources` map. Each key is a source ID; each value is a bounded shell command plus optional display metadata:

| Key | Type | Required | Purpose |
| --- | --- | --- | --- |
| `command` | string | yes | One-shot shell command run on each refresh. Must exit quickly and print a single JSON line on stdout. |
| `unit` | string | no | Unit suffix appended to numeric readings (for example `°C` or `ppm`). |
| `open_command` | string | no | Shell command run when Enter opens the card (for example a Home Assistant more-info launcher). |

Supported source IDs:

| Source ID | Dashboard card |
| --- | --- |
| `twitch` | Live Channels |
| `calendar` | Events in the next hour (hidden when the source is missing) |
| `todo_my_tasks` | My Tasks |
| `todo_work` | Work Tasks |
| `temperature` | Temperature |
| `co2` | CO2 |
| `voc` | VOC |

Example:

```yaml
sources:
  twitch:
    command: twitch-menu channels --bar-json
  calendar:
    command: ha-entity-bar-json-once input_text.current_next_event_in_an_hour
  temperature:
    command: ha-entity-bar-json-once sensor.living_room_temperature
    unit: "°C"
    open_command: home-assistant-tui more-info sensor.living_room_temperature
  todo_my_tasks:
    command: home-assistant-tui todo todo.my_tasks --bar-json
    open_command: home-assistant-tui todo todo.my_tasks
```

## Command contract

Each `command` must behave like a status-bar poll, not a long-running watcher:

- Print one JSON object on the first line of stdout.
- Use the same `--bar-json` shape as Waybar modules: `text`, `tooltip`, and `class` fields. See [Bar Integrations](/bar-integrations/).
- Finish within eight seconds. `dot dashboard` kills overdue commands with `SIGTERM`.
- Avoid unbounded stream helpers. Commands containing `ha-watch-singleton`, `singleton-stream`, or `doorbell` are rejected as unsafe.

On refresh failure the card shows a diagnostic message; a `{"error":"..."}` JSON line is treated as an error state. An empty first line hides the card.

## Refresh behaviour

After the initial load, dashboard sources refresh automatically every 60 seconds and on manual refresh (`r` in the TUI). Git, notification, and workflow cards use the same live services as their dedicated TUI views.

:::note[Private by default]
`dot-dashboard.yml` lives in the private dotfiles overlay because it contains machine-specific commands and entity names. The public dotfiles only contain the logic that reads it.
:::
