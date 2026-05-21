# Handoff: Phase 1A — `dot stow` Command

## Focus

Port the `dot stow` command from bash to TypeScript Effect. This is the simplest core command — just subprocess calls with logging — making it the ideal first command to validate the new architecture.

---

## Prerequisites

Phase 0 must be complete. The following services must exist and work:
- `Config` (provides `publicDotfiles`, `privateDotfiles`, `canUsePrivate`)
- `OutputLog` (for logging sections/info/errors)
- `Launcher` (for streaming subprocess output)
- `CommandExecutor` (for running stow)

---

## What `dot stow` Does (from bash)

Reference: `scripts/.local/bin/dot-legacy` — `cmd_stow` (line ~1946) and `run_stow` (line ~1442).

### Legacy behaviour

1. Parse `--public` / `--private` flags (no flags = both)
2. Log section: `Stow workflow`
3. For public: list stow folders, then per-folder:
   - Log: `[public] stow <folder> (repo: ~/.config/dotfiles)`
   - Unstow (`stow -D <folder>`)
   - Restow (plain `stow <folder>`, or `--no-folding` for `agents`)
4. If private available: repeat for private scope
5. If private unavailable: `log_warn "Skipping private stow (<reason>)"`

### Key stow invocation (simplified port)

```bash
stow --restow --no-folding --adopt --target="$HOME" .
```

Run from within the dotfiles directory (public or private). The simplified single-command approach replaces per-folder iteration for the initial port (agents special-casing deferred to a follow-up if needed).

### Logging level (match legacy)

Legacy outputs ~1 `log_info` line per stow folder (typically 5–10 folders per scope), plus section headings, repo paths, and skip warnings. The port should aim for similar density:
- Section heading per scope (not just one for the whole command)
- Repo path shown at scope start
- Per-scope success/failure confirmation
- Warning with reason when private is skipped
- No "Complete" section at the end — legacy doesn't have one; just finish after the last scope

---

## Implementation

### `dot/src/commands/Stow.ts`

```typescript
import { Effect } from "effect"
import { Config } from "../services/Config.js"
import { OutputLog } from "../services/OutputLog.js"
import { Launcher } from "../services/Launcher.js"

export const stow = Effect.gen(function* () {
  const config = yield* Config
  const log = yield* OutputLog
  const launcher = yield* Launcher

  yield* log.section("Stow workflow")

  // --- Public scope ---
  yield* log.section("Stow public dotfiles")
  yield* log.info(`Public repo: ${config.displayPath(config.publicDotfiles)}`)

  const publicExit = yield* launcher.stream(
    "stow --restow --no-folding --adopt --target=$HOME .",
    { cwd: config.publicDotfiles }
  )
  if (publicExit !== 0) {
    yield* log.error("Public stow failed")
    return
  }
  yield* log.info("Public dotfiles stowed successfully")

  // --- Private scope ---
  if (!config.canUsePrivate || !config.privateDotfiles) {
    yield* log.warn(`Skipping private stow (${config.privateReason})`)
    return
  }

  yield* log.section("Stow private dotfiles")
  yield* log.info(`Private repo: ${config.displayPath(config.privateDotfiles)}`)

  const privateExit = yield* launcher.stream(
    "stow --restow --no-folding --adopt --target=$HOME .",
    { cwd: config.privateDotfiles }
  )
  if (privateExit !== 0) {
    yield* log.error("Private stow failed")
    return
  }
  yield* log.info("Private dotfiles stowed successfully")
})
```

### Wire into dispatch

In `src/index.ts`, add `"stow"` to the command routing:
```typescript
case "stow": return stow
```

### Flags

- `--public` — Stow public dotfiles only
- `--private` — Stow private dotfiles only
- No flags = both scopes (matches legacy behaviour)

### Config service requirements

The implementation references these `Config` fields:
- `publicDotfiles` — path to public repo
- `privateDotfiles` — path to private repo (may be undefined)
- `canUsePrivate` — boolean: private repo accessible
- `privateReason` — human-readable reason when private unavailable (e.g. `"private repo not present/readable"`)
- `displayPath(path)` — helper that replaces `$HOME` prefix with `~` for log output

---

## Validation

```bash
cd ~/.config/dotfiles/dot && bun run build
dot stow              # Should stow public + private, streaming output
dot stow --public     # Should stow public only
dot stow --private    # Should stow private only (or warn if unavailable)
dot stow 2>&1 | cat   # Should detect non-TTY, use CLI mode (plain stdout)
```

Expected output shape (similar to legacy):
```
── Stow workflow
── Stow public dotfiles
[INFO]   Public repo: ~/.config/dotfiles
[INFO]   Public dotfiles stowed successfully
── Stow private dotfiles
[INFO]   Private repo: ~/.config/dotfiles-private
[INFO]   Private dotfiles stowed successfully
```

Verify by checking symlinks are intact: `ls -la ~/.local/bin/dot`

---

## Key Files to Read

| Path | Why |
|------|-----|
| `scripts/.local/bin/dot-legacy` | `cmd_stow` (~line 1946), `run_stow` (~line 1442) |
| `.stowrc` | Stow configuration (ignore rules, target) |
| `dot/src/services/Launcher.ts` | The streaming API to use |
| `dot/src/services/Config.ts` | Paths, `canUsePrivate`, `privateReason`, `displayPath` |
| `dot/src/services/OutputLog.ts` | `section`, `info`, `warn`, `error` methods |

---

## Suggested Skills

- `effect` — Effect.gen, service dependencies
- `dotfiles-stow` — Stow workflow constraints
- `types-enforce-ts` — Type safety

---

## Constraints

- Use `Launcher.stream` (not raw Bun.spawn) for the stow subprocess
- Log via `OutputLog` (not console.log)
- Respect `Config.canUsePrivate` — skip private stow gracefully if unavailable
