# Handoff: Phase 1B — `dot update` Command

## Focus

Port the `dot update` command from bash to TypeScript Effect. This is the most-used command — it pulls repos, stows, rebuilds the binary, and runs post-hooks. It exercises the full service stack including self-rebuild.

---

## Prerequisites

- Phase 0 complete (all core services working)
- Phase 1A complete (`stow` command works — reused by update)

---

## What `dot update` Does (from bash)

Reference: `scripts/.local/bin/dot-legacy` (search for `cmd_update`, ~line 1738).

### Legacy behaviour

1. Parse `--pull` / `--stow` / `--tui` flags (no flags = full update: all steps)
2. `log_section 'Update workflow'`
3. **Fetch & check** — `diff_collect_attention` (verbose: logs per-repo status)
4. If nothing behind: log "All repositories are up to date" or warn about dirty/ahead repos
5. If repos behind:
   - Per-scope: `log_section 'Public repo pull'`, `log_section 'Private repo pull'`, etc.
   - Pull each behind repo, log name + `display_path`
   - Extra repos pulled in a loop with `log_section 'Additional private repo pulls'`
   - Omarchy repos: `log_section 'Omarchy repo sync'`
6. **Stow** — `log_section 'Stow public dotfiles'` + `log_section 'Stow private dotfiles'`
7. **TUI build** — `maybe_build_tui` (only logs if it actually rebuilds)
8. **Post-hooks** — agents sync, notifications, skill updates (only when repos updated)
9. Skip warning: `log_warn "Skipping private and notes pull ($PRIVATE_REASON)"` when private unavailable

### Logging level (match legacy)

Legacy outputs ~1 section heading per phase, ~1 info line per repo pulled, plus skip warnings. The port should aim for similar density:
- Section heading per phase (`Pull Repositories`, `Stow`, `Rebuild`, etc.)
- Per-repo info line when pulling: name + path shown
- Skip warnings with reason when private unavailable
- Attention summary when repos are dirty/ahead but not behind
- No artificial "Complete" section at the end — legacy finishes after post-hooks

---

## Implementation

### `dot/src/commands/Update.ts`

```typescript
import { Effect } from "effect"
import { Config } from "../services/Config.js"
import { OutputLog } from "../services/OutputLog.js"
import { Launcher } from "../services/Launcher.js"
import { CommandExecutor } from "../services/CommandExecutor.js"
import { stow } from "./Stow.js"
import { rebuild } from "../lib/selfUpdate.js"

const pullRepo = (name: string, path: string) =>
  Effect.gen(function* () {
    const log = yield* OutputLog
    const launcher = yield* Launcher
    const displayPath = path.replace(process.env.HOME ?? "", "~")
    yield* log.info(`Pulling ${name} (${displayPath})...`)
    const exit = yield* launcher.stream("git pull --rebase --no-edit", { cwd: path })
    if (exit !== 0) yield* log.warn(`Pull failed for ${name}`)
  })

export const update = Effect.gen(function* () {
  const config = yield* Config
  const log = yield* OutputLog
  const launcher = yield* Launcher

  yield* log.section("Update Workflow")

  // Pull repos
  yield* log.section("Pull Repositories")
  yield* pullRepo("public dotfiles", config.publicDotfiles)
  if (config.canUsePrivate && config.privateDotfiles) {
    yield* pullRepo("private dotfiles", config.privateDotfiles)
  } else {
    yield* log.warn(`Skipping private pull (${config.privateReason})`)
  }

  // Omarchy sync (external — subprocess call)
  yield* log.section("Omarchy Repo Sync")
  yield* launcher.stream("dot-legacy update --omarchy-only")

  // Stow
  yield* stow()

  // Install missing packages (stays as bash fallback until ported)
  yield* log.section("Packages")
  yield* launcher.stream("dot-legacy update --packages-only")

  // Rebuild self
  yield* log.section("Rebuild")
  yield* rebuild
  yield* log.info("Build successful")
})
```

Note: After rebuild, the command exits 0. No relaunch — the next invocation
of `dot` will naturally use the new binary.

### Self-Update Detail

```typescript
// dot/src/lib/selfUpdate.ts
import { Effect } from "effect"
import { CommandExecutor } from "../services/CommandExecutor.js"

const DOT_SRC = /* resolve from import.meta or config */

export const rebuild = Effect.gen(function* () {
  const executor = yield* CommandExecutor
  // Install deps
  yield* executor.run("bun", ["install"], { cwd: DOT_SRC })
  // Build to temp path
  const tmpPath = `${process.execPath}.new`
  yield* executor.run("bun", ["build", "src/index.ts", "--compile", "--outfile", tmpPath], { cwd: DOT_SRC })
  // Atomic rename
  yield* Effect.sync(() => {
    const fs = require("fs")
    fs.renameSync(tmpPath, process.execPath)
    fs.chmodSync(process.execPath, 0o755)
  })
})
```

No relaunch step — the process exits 0 after rebuild completes.

### Incremental Strategy

During gradual migration, some update sub-steps stay as `dot-legacy` calls:
- Omarchy sync → `dot-legacy` subprocess (omarchy is external)
- Package install → `dot-legacy` subprocess (until packages ported)

These get removed as later phases port those concerns.

---

## Validation

```bash
cd ~/.config/dotfiles/dot && bun run build
dot update            # Should pull, stow, rebuild, exit 0
dot update --pull     # Pull-only mode
dot update --stow     # Stow-only mode
dot update --tui      # TUI build-only mode
# Verify the binary is the new build:
dot --version         # (if version flag exists) or check binary mtime
```

Expected output shape (similar to legacy):
```
── Update Workflow
── Pull Repositories
[INFO]   Pulling public dotfiles (~/.config/dotfiles)...
[INFO]   Pulling private dotfiles (~/.config/dotfiles-private)...
── Omarchy Repo Sync
[INFO]   ...
── Stow Public Dotfiles
[INFO]   [public] stow agents (repo: ~/.config/dotfiles)
[INFO]   [public] stow scripts (repo: ~/.config/dotfiles)
── Stow Private Dotfiles
[INFO]   [private] stow agents (repo: ~/.config/dotfiles-private)
── Packages
[INFO]   ...
── Rebuild
[INFO]   Build successful
```

---

## Key Files to Read

| Path | Why |
|------|-----|
| `scripts/.local/bin/dot-legacy` | Search for `cmd_update` — full update logic |
| `dot/src/commands/Stow.ts` | Reused by update |
| `dot/src/lib/selfUpdate.ts` | Rebuild implementation |
| `dot/src/services/Launcher.ts` | Streaming subprocess API |

---

## Suggested Skills

- `effect` — Effect.gen, service composition, Effect.sync for side effects
- `types-enforce-ts` — Type safety
- `dotfiles-stow` — Stow constraints (update triggers stow)

---

## Constraints

- Self-rebuild uses atomic rename (write to `.new`, rename over running binary)
- No relaunch — process exits 0 after rebuild; next `dot` invocation uses new binary
- Omarchy stays as external subprocess call (never port omarchy logic)
- Package install stays as bash fallback until a dedicated packages phase
- Log all steps via OutputLog — user sees progress in TUI or stdout
- Match legacy logging density: section headings + per-repo info lines + skip warnings
- No artificial "Complete" section at the end
