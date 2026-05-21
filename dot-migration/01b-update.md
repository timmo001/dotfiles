# Handoff: Phase 1B — `dot update` Command

## Focus

Port the `dot update` command from bash to TypeScript Effect. This is the most-used command — it pulls repos, stows, rebuilds the binary, and runs post-hooks. It exercises the full service stack including self-update + relaunch.

---

## Prerequisites

- Phase 0 complete (all core services working)
- Phase 1A complete (`stow` command works — reused by update)

---

## What `dot update` Does (from bash)

Reference: `scripts/.local/bin/dot-legacy` (search for `cmd_update`).

Approximate flow (110 lines):

1. **Pull public dotfiles** — `git pull --rebase --no-edit` in `$PUBLIC_DOTFILES`
2. **Pull private dotfiles** — same, if available
3. **Pull omarchy repos** — calls `omarchy_sync_repos` (external, keep as subprocess)
4. **Stow** — runs the stow logic (reuse Phase 1A's `stow` command)
5. **Install missing packages** — checks for missing public Arch packages, installs via `paru`
6. **Build dot binary** — `bun install && bun run build` in the `dot/` source directory
7. **Agents sync** — runs `dot agents-sync` if configured
8. **Log completion**

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
import { rebuild, relaunch } from "../lib/selfUpdate.js"

const pullRepo = (name: string, path: string) =>
  Effect.gen(function* () {
    const log = yield* OutputLog
    const launcher = yield* Launcher
    yield* log.info(`Pulling ${name}...`)
    const exit = yield* launcher.stream("git pull --rebase --no-edit", { cwd: path })
    if (exit !== 0) yield* log.warn(`Pull failed for ${name}`)
  })

export const update = Effect.gen(function* () {
  const config = yield* Config
  const log = yield* OutputLog
  const launcher = yield* Launcher

  // Pull repos
  yield* log.section("Pull Repositories")
  yield* pullRepo("public dotfiles", config.publicDotfiles)
  if (config.canUsePrivate && config.privateDotfiles) {
    yield* pullRepo("private dotfiles", config.privateDotfiles)
  }

  // Omarchy sync (external — subprocess call)
  yield* log.section("Sync Omarchy")
  yield* launcher.stream("dot-legacy update --omarchy-only")
  // OR: directly call omarchy sync commands

  // Stow
  yield* log.section("Stow")
  yield* stow

  // Install missing packages
  yield* log.section("Packages")
  yield* launcher.stream("dot-legacy update --packages-only")
  // This stays as bash fallback until packages are ported

  // Rebuild self
  yield* log.section("Rebuild")
  yield* rebuild
  yield* log.info("Build successful — relaunching...")
  yield* relaunch
})
```

Note: The `relaunch` at the end means the process re-execs itself with the new binary. The new binary picks up from a fresh start (not mid-update). This is intentional — the update is complete before relaunch.

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

export const relaunch = Effect.sync(() => {
  const proc = Bun.spawn([process.execPath, ...process.argv.slice(1)], {
    stdio: ["inherit", "inherit", "inherit"],
  })
  proc.unref()
  process.exit(0)
})
```

### Incremental Strategy

During gradual migration, some update sub-steps stay as `dot-legacy` calls:
- Omarchy sync → `dot-legacy` subprocess (omarchy is external)
- Package install → `dot-legacy` subprocess (until packages ported)

These get removed as later phases port those concerns.

---

## Validation

```bash
cd ~/.config/dotfiles/dot && bun run build
dot update            # Should pull, stow, rebuild, relaunch
# After relaunch, verify the binary is the new build:
dot --version         # (if version flag exists) or check binary mtime
```

---

## Key Files to Read

| Path | Why |
|------|-----|
| `scripts/.local/bin/dot-legacy` | Search for `cmd_update` — full update logic |
| `dot/src/commands/Stow.ts` | Reused by update |
| `dot/src/lib/selfUpdate.ts` | Rebuild + relaunch implementation |
| `dot/src/services/Launcher.ts` | Streaming subprocess API |

---

## Suggested Skills

- `effect` — Effect.gen, service composition, Effect.sync for side effects
- `types-enforce-ts` — Type safety
- `dotfiles-stow` — Stow constraints (update triggers stow)

---

## Constraints

- Self-rebuild uses atomic rename (write to `.new`, rename over running binary)
- Relaunch re-execs with same argv — the new binary starts fresh
- Omarchy stays as external subprocess call (never port omarchy logic)
- Package install stays as bash fallback until a dedicated packages phase
- Log all steps via OutputLog — user sees progress in TUI or stdout
