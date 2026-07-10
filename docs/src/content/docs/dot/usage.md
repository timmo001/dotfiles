---
title: Usage Analytics
description: Local-first usage tracking for dot with optional shell-history observations.
sidebar:
  order: 7
---

`dot usage` records local-first analytics for the `dot` CLI so you can see which features are actually used, split human from agent from automated calls, and decide whether a feature earns its keep. Its optional history backfill can also observe selected standalone CLI invocations without requiring those projects to integrate with dotfiles.

Recording is local, privacy-conscious, and off nobody's server: each invocation appends one NDJSON event under `$XDG_STATE_HOME/tool-usage`. Only the canonical subcommand path and flag names declared by that command are stored, never positional values such as paths, ids, or note text.

## How it works

`dot` installs a best-effort exit hook that appends one event when the process exits, capturing the real exit code and duration:

```json
{"ts":"2026-07-08T20:45:30Z","machine":"desktop","tool":"dot","invokedAs":"dot","command":["git-diff"],"flags":["--raw"],"exitCode":0,"durationMs":63,"source":"live","invoker":"human"}
```

Events are written per machine and per day:

```text
$XDG_STATE_HOME/tool-usage/events/<machine>/YYYY-MM-DD.ndjson
```

`invoker` is one of `human`, `agent` (an AI coding agent was detected), or `automation` (a status-bar poll, detected from `--bar-json`), so Waybar polling does not drown out genuine feature usage.

## Reporting

```bash
dot usage summary                      # per-feature table (last 90 days)
dot usage summary --days 30            # narrow the window
dot usage summary --format json        # machine-readable
dot usage summary --format agent-context  # compact, for feeding an agent
dot usage stale --days 90              # features not used recently + dot commands never seen
dot usage path                         # print the event root
```

The summary groups by tool and command, showing total, human, agent, automation, failure count, median duration, and last-seen date.

## Backfill from shell history

Prefill from existing shell history. Only whitelisted binaries (`dot`, `context`, `notes`, `note`, `handoff`, `handoffs`) are observed, and only from shells that timestamp history (fish and zsh extended history); bash is skipped because its history is undated. This is a dot-owned observation layer: the standalone projects remain independent and do not write dot usage events.

```bash
dot usage backfill --history           # dry run: counts by tool, writes nothing
dot usage backfill --history --apply   # write the imported events
```

Backfilled events are marked `source: "history"` with a null exit code and duration, and are deduplicated so re-running is safe.

## Two machines

Each machine writes its own per-machine files, so nothing conflicts when the directory is synced (Syncthing, a shared folder, or a private repo). Combine roots at read time:

```bash
dot usage summary --root ~/synced/other-machine/tool-usage
```

## Configuration

- `DOT_USAGE_DIR` - relocate the event root (default `$XDG_STATE_HOME/tool-usage`).
- `DOT_USAGE_DISABLE=1` - stop live dot recording.
- `OMARCHY_HOST` - overrides the machine identifier used to partition event files (falls back to the system hostname).
