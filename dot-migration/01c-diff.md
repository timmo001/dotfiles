# Handoff: Phase 1C — `dot diff` Command

## Focus

Port the `dot diff` command. This is the most multi-modal command — it has machine-output modes (--waybar, --list-changed, --list-all), a CLI text mode (--raw), and the TUI DiffView. The TUI DiffView already exists; this phase ensures all modes route through the new binary correctly.

---

## Prerequisites

- Phase 0 complete (CLI dispatch, auto-detect mode, services)
- Existing `DotDiff` service and `DiffView` already work

---

## What `dot diff` Does (from bash)

Reference: `scripts/.local/bin/dot-legacy` (search for diff handling, ~63 lines).

### Modes

| Invocation | Output | TUI? |
|-----------|--------|------|
| `dot diff` | DiffView (interactive) | Yes |
| `dot diff --waybar` | Single-line JSON | No |
| `dot diff --list-changed` | `name\|path` lines (dirty repos only) | No |
| `dot diff --list-all` | `name\|path` lines (all repos) | No |
| `dot diff --raw` | Coloured text (git status per repo) | No |

### Machine Output Formats

**--waybar:**
```json
{"text":"2","tooltip":"dotfiles (1 ahead)\nhypr (3 modified)","class":"has-changes"}
```

**--list-changed / --list-all:**
```
dotfiles|/home/aidan/.config/dotfiles
hypr|/home/aidan/.config/hypr
```

**--raw:**
Plain coloured text — section headings per repo, git status output.

---

## Implementation

### `dot/src/commands/Diff.ts`

```typescript
import { Effect, Stream } from "effect"
import { Config } from "../services/Config.js"
import { DotDiff } from "../services/DotDiff.js"
import { OutputLog } from "../services/OutputLog.js"
import type { Repo } from "../types.js"

/** Machine output: --waybar JSON */
export const diffWaybar = Effect.gen(function* () {
  const dotDiff = yield* DotDiff
  const repos = yield* dotDiff.getAll()
  const changed = repos.filter(r => r.isDirty || r.ahead > 0 || r.behind > 0)

  const text = changed.length > 0 ? String(changed.length) : ""
  const tooltip = changed.map(r => {
    const parts: string[] = []
    if (r.modified > 0) parts.push(`${r.modified} modified`)
    if (r.ahead > 0) parts.push(`${r.ahead} ahead`)
    if (r.behind > 0) parts.push(`${r.behind} behind`)
    return `${r.name} (${parts.join(", ")})`
  }).join("\n")
  const cls = changed.length > 0 ? "has-changes" : "no-changes"

  yield* Effect.sync(() => process.stdout.write(JSON.stringify({ text, tooltip, class: cls }) + "\n"))
})

/** Machine output: --list-changed */
export const diffListChanged = Effect.gen(function* () {
  const dotDiff = yield* DotDiff
  const repos = yield* dotDiff.getAll()
  const changed = repos.filter(r => r.isDirty || r.ahead > 0 || r.behind > 0)
  yield* Effect.sync(() => {
    for (const r of changed) process.stdout.write(`${r.name}|${r.path}\n`)
  })
})

/** Machine output: --list-all */
export const diffListAll = Effect.gen(function* () {
  const dotDiff = yield* DotDiff
  const repos = yield* dotDiff.getAll()
  yield* Effect.sync(() => {
    for (const r of repos) process.stdout.write(`${r.name}|${r.path}\n`)
  })
})

/** CLI text output: --raw */
export const diffRaw = Effect.gen(function* () {
  const dotDiff = yield* DotDiff
  const log = yield* OutputLog
  const repos = yield* dotDiff.getAll()
  const changed = repos.filter(r => r.isDirty || r.ahead > 0 || r.behind > 0)

  if (changed.length === 0) {
    yield* log.info("All repositories clean")
    return
  }

  for (const repo of changed) {
    yield* log.section(repo.name)
    yield* log.info(`Path: ${repo.path}`)
    if (repo.ahead > 0) yield* log.info(`${repo.ahead} commit(s) ahead`)
    if (repo.behind > 0) yield* log.warn(`${repo.behind} commit(s) behind`)
    if (repo.modified > 0) yield* log.info(`${repo.modified} modified file(s)`)
  }
})

/** TUI mode: opens DiffView (default) — handled by existing App routing */
```

### Dispatch Routing

In `src/index.ts`:
```typescript
if (flags.subcommand === "diff") {
  if (flags.waybar) return run(diffWaybar, MachineOutputLayers)
  if (flags.listChanged) return run(diffListChanged, MachineOutputLayers)
  if (flags.listAll) return run(diffListAll, MachineOutputLayers)
  if (flags.raw) return run(diffRaw, CliLayers)
  // Default: TUI mode with DiffView
  return run(tuiProgram({ initialView: "diff", tab: flags.tab }), TuiLayers)
}
```

Machine output modes use minimal layers (just `Config` + `DotDiff` + `CommandExecutor`). No Renderer, no OutputLog.

### Adapt Existing `DotDiff` Service

The current `DotDiff` service calls `dot diff --list-all` and `dot diff --list-changed` via subprocess. In the new world, this creates a circular dependency (binary calling itself). Refactor `DotDiff` to compute repo state directly:

```typescript
// Instead of calling `dot diff --list-all`, compute git status directly:
class DotDiff extends Context.Service<DotDiff, DotDiffService>()("DotDiff") {
  static readonly layer = Layer.effect(DotDiff, Effect.gen(function* () {
    const config = yield* Config
    const executor = yield* CommandExecutor
    return {
      getAll: () => Effect.gen(function* () {
        // Read repo list from config
        // For each repo, run `git status --porcelain` + `git rev-list --count`
        // Return structured Repo[] data
      })
    }
  }))
}
```

This eliminates the self-call and makes the diff data available to all modes.

---

## Validation

```bash
dot diff --waybar      # JSON line to stdout
dot diff --list-changed # pipe-delimited lines
dot diff --list-all    # pipe-delimited lines (all repos)
dot diff --raw         # coloured text output
dot diff               # TUI DiffView opens
echo "test" | dot diff --waybar  # works even when stdin is a pipe
```

---

## Key Files to Read

| Path | Why |
|------|-----|
| `scripts/.local/bin/dot-legacy` | Search for diff modes (~line 2020-2090) |
| `dot/src/services/DotDiff.ts` | Current service to refactor |
| `dot/src/tui/DiffView.ts` | Existing TUI view (should still work) |
| `dot/src/services/WaybarCache.ts` | Waybar cache for fast first paint |
| `dot/src/services/RepoWatcher.ts` | Subscribes to DotDiff |

---

## Suggested Skills

- `effect` — Effect.gen, Stream, service refactoring
- `opentui` — Existing DiffView integration
- `types-enforce-ts` — Type safety

---

## Constraints

- Machine-output modes MUST NOT import or initialise the Renderer
- Machine-output modes write directly to stdout (no OutputLog)
- Refactoring DotDiff to compute state directly (no self-calling the binary)
- Existing DiffView and RepoWatcher must continue working unchanged
- WaybarCache integration stays (reads `~/.cache/waybar/dot-diff-waybar.json`)
