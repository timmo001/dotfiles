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

Reference: `scripts/.local/bin/dot-legacy` (search for the stow command handling).

1. `cd $PUBLIC_DOTFILES`
2. Run `stow` with flags: `--restow --no-folding --adopt .` against `$HOME`
3. If private dotfiles available: `cd $PRIVATE_DOTFILES` and stow there too
4. Log each step with section headings

The key stow invocation is:
```bash
stow --restow --no-folding --adopt --target="$HOME" .
```

Run from within the dotfiles directory (public or private).

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

  yield* log.section("Stow Public Dotfiles")
  const publicExit = yield* launcher.stream(
    "stow --restow --no-folding --adopt --target=$HOME .",
    { cwd: config.publicDotfiles }
  )
  if (publicExit !== 0) {
    yield* log.error("Public stow failed")
    return
  }
  yield* log.info("Public dotfiles stowed")

  if (config.canUsePrivate && config.privateDotfiles) {
    yield* log.section("Stow Private Dotfiles")
    const privateExit = yield* launcher.stream(
      "stow --restow --no-folding --adopt --target=$HOME .",
      { cwd: config.privateDotfiles }
    )
    if (privateExit !== 0) {
      yield* log.error("Private stow failed")
      return
    }
    yield* log.info("Private dotfiles stowed")
  }

  yield* log.section("Complete")
  yield* log.info("All packages stowed successfully")
})
```

### Wire into dispatch

In `src/index.ts`, add `"stow"` to the command routing:
```typescript
case "stow": return stow
```

### Flags

- `--restow` — already the default (always restow)
- No additional flags needed for the basic port

---

## Validation

```bash
cd ~/.config/dotfiles/dot && bun run build
dot stow              # Should stow public + private, streaming output
dot stow 2>&1 | cat  # Should detect non-TTY, use CLI mode (plain stdout)
```

Verify by checking symlinks are intact: `ls -la ~/.local/bin/dot`

---

## Key Files to Read

| Path | Why |
|------|-----|
| `scripts/.local/bin/dot-legacy` | Search for stow logic (around line 2100) |
| `.stowrc` | Stow configuration (ignore rules, target) |
| `dot/src/services/Launcher.ts` | The streaming API to use |
| `dot/src/services/Config.ts` | Paths for public/private dotfiles |

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
