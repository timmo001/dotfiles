# Handoff: Phase 0 — Foundation

## Focus

Set up the new `dot/` directory, core Effect services, CLI dispatch, bash fallback, and the OutputPane TUI view. This phase produces a working binary that opens the TUI (existing views) and falls back to bash for all commands.

---

## Context

The `dot` bash script (2,294 lines) is being replaced by a compiled Bun/Effect binary. The existing `tui/` directory already has an Effect v4 + OpenTUI application. This phase renames it, restructures services to be fully Effect-native (no plain object workarounds), and wires up the dispatch that makes the gradual migration possible.

**Workspace:** `~/.config/dotfiles`

---

## Decisions (resolved, do not re-ask)

- Gradual migration — unported commands dispatch to renamed bash script (`dot-legacy`)
- Binary replaces bash script at `scripts/.local/bin/dot`
- Rename `tui/` → `dot/`
- No args = TUI menu
- Auto-detect output mode: TUI if interactive TTY, plain stdout if piped
- Remove zsh `dot()` wrapper entirely (drop auto-cd)
- No environment variable toggles — flags only
- Full Effect architecture — no plain object workarounds
- External tools stay as subprocess calls via Effect Command API

---

## Steps

### 0.1 Rename `tui/` → `dot/`

- `git mv tui dot`
- Update `package.json`: name → `dot-cli`, build script output → `../scripts/.local/bin/dot`
- Update `.stowrc`: change `--ignore=^/tui` to `--ignore=^/dot`
- Update root `AGENTS.md` references from `tui/` to `dot/`

### 0.2 Rename bash script

- `git mv scripts/.local/bin/dot scripts/.local/bin/dot-legacy`
- The fallback mechanism calls `dot-legacy` for unported commands

### 0.3 Implement `Config` service

```typescript
// dot/src/services/Config.ts
interface ConfigService {
  readonly publicDotfiles: string
  readonly privateDotfiles: string | null
  readonly canUsePrivate: boolean
  readonly cacheDir: string
  readonly stateDir: string
  readonly logDir: string
}

class Config extends Context.Service<Config, ConfigService>()("Config") {
  static readonly layer = Layer.effect(Config, Effect.gen(function* () { ... }))
}
```

Reads paths from XDG dirs. Detects private dotfiles by checking `~/.config/dotfiles-private/.git` exists.

### 0.4 Implement `Renderer` service (scoped)

```typescript
// dot/src/services/Renderer.ts
class Renderer extends Context.Service<Renderer, CliRenderer>()("Renderer") {
  static readonly layer = Layer.scoped(
    Renderer,
    Effect.acquireRelease(
      Effect.promise(() => createCliRenderer({ ... })),
      (r) => Effect.sync(() => r.destroy())
    )
  )
}
```

The renderer is only provided in TUI mode layers. CLI mode does not include it.

### 0.5 Implement `OutputLog` service

```typescript
// dot/src/services/OutputLog.ts
interface LogEntry { level: "info" | "warn" | "error" | "section"; message: string; timestamp: number }

interface OutputLogService {
  readonly info: (msg: string) => Effect<void>
  readonly warn: (msg: string) => Effect<void>
  readonly error: (msg: string) => Effect<void>
  readonly section: (title: string) => Effect<void>
  readonly stream: Stream<LogEntry>
  readonly flush: Effect<string>
}
```

Two layer implementations:
- `OutputLog.tuiLayer` — PubSub-backed, OutputPane subscribes to stream
- `OutputLog.cliLayer` — writes directly to stdout with ANSI colours

Both write to a log file at `~/.local/state/dot/logs/<timestamp>.log`.

### 0.6 Implement `CommandExecutor` service

Wraps `@effect/platform` Command API. If `@effect/platform-bun` provides a `CommandExecutor` layer, use it. Otherwise wrap `Bun.spawn` in Effect:

```typescript
interface CommandExecutorService {
  readonly run: (cmd: string, args: string[], opts?: { cwd?: string }) => Effect<string, CommandError>
  readonly stream: (cmd: string, args: string[], opts?: { cwd?: string }) => Stream<string, CommandError>
  readonly exitCode: (cmd: string, args: string[], opts?: { cwd?: string }) => Effect<number, CommandError>
  readonly inherit: (cmd: string, args: string[], opts?: { cwd?: string }) => Effect<number, CommandError>
}
```

### 0.7 Implement `Launcher` service

Depends on `Renderer` (optional — only in TUI mode), `OutputLog`, `CommandExecutor`:

```typescript
interface LauncherService {
  readonly suspend: (cmd: string, opts?: { waitForKey?: boolean }) => Effect<void, LauncherError>
  readonly stream: (cmd: string, opts?: { cwd?: string }) => Effect<number, LauncherError>
  readonly silent: (cmd: string) => Effect<string, LauncherError>
}
```

- `suspend`: renderer.suspend() → spawn with inherited stdio → renderer.resume()
- `stream`: CommandExecutor.stream → pipe each line through OutputLog.info → return exit code
- `silent`: CommandExecutor.run → return result string

### 0.8 Implement `Toast` as Effect service

```typescript
class Toast extends Context.Service<Toast, ToastService>()("Toast") {
  static readonly layer = Layer.effect(Toast, Effect.gen(function* () {
    const renderer = yield* Renderer
    // ... create Toast renderable, return service
  }))
}
```

### 0.9 Implement `OutputPane` TUI view

Full-screen `ScrollBoxRenderable` with `stickyScroll: true`. Subscribes to `OutputLog.stream`. Shows during command execution, hides when command completes. Back/Escape returns to previous view.

### 0.10 Implement `BashFallback` command

```typescript
export const bashFallback = (subcommand: string, args: string[]) =>
  Effect.gen(function* () {
    const launcher = yield* Launcher
    yield* launcher.suspend(`dot-legacy ${subcommand} ${args.join(" ")}`)
  })
```

### 0.11 Build CLI dispatch (`src/index.ts`)

```
1. Parse argv → { subcommand, flags, args }
2. If --help → print help, exit
3. Route:
   a. Machine-output flags → run command, stdout, exit (no TUI/layers)
   b. Subcommand + non-interactive → CLI layers + command effect
   c. Subcommand + interactive TTY → TUI layers + OutputPane + command effect
   d. No subcommand → TUI layers + MainMenu
   e. Unknown subcommand → BashFallback (suspend mode)
```

### 0.12 Implement self-update logic

```typescript
// dot/src/lib/selfUpdate.ts
export const rebuild = Effect.gen(function* () {
  const executor = yield* CommandExecutor
  const tmpPath = `${process.execPath}.new`
  yield* executor.run("bun", ["build", "src/index.ts", "--compile", "--outfile", tmpPath], { cwd: dotSrcDir })
  yield* Effect.sync(() => { fs.renameSync(tmpPath, process.execPath); fs.chmodSync(process.execPath, 0o755) })
})

export const relaunch = Effect.sync(() => {
  Bun.spawn([process.execPath, ...process.argv.slice(1)], { stdio: ["inherit", "inherit", "inherit"] }).unref()
  process.exit(0)
})
```

### 0.13 Layer composition

```typescript
// TUI mode
const TuiLayers = pipe(
  Config.layer,
  Layer.provideMerge(CommandExecutor.layer),
  Layer.provideMerge(Renderer.layer),
  Layer.provideMerge(OutputLog.tuiLayer),
  Layer.provideMerge(Toast.layer),
  Layer.provideMerge(Launcher.tuiLayer),
  // existing services...
  Layer.provideMerge(RepoWatcher.layer),
  Layer.provideMerge(DotDiff.layer),
  Layer.provideMerge(WaybarCache.layer),
  Layer.provideMerge(GitStaging.layer),
  Layer.provideMerge(CommitSuggest.layer),
)

// CLI mode
const CliLayers = pipe(
  Config.layer,
  Layer.provideMerge(CommandExecutor.layer),
  Layer.provideMerge(OutputLog.cliLayer),
  Layer.provideMerge(Launcher.cliLayer),
)
```

### 0.14 Remove zsh wrapper

Delete the `dot()` function from `zsh/.zshrc`. Users call the binary directly.

### 0.15 Update stow ignores

Update `.stowrc` to ignore `dot/` directory (source code, not stowed).

### 0.16 Validation

```bash
cd ~/.config/dotfiles/dot && bun run build
dot                    # → TUI menu opens
dot help               # → prints help
dot update             # → falls back to dot-legacy
dot diff --waybar      # → JSON output, no TUI
```

---

## Key Files to Read

| Path | Why |
|------|-----|
| `dot/src/index.ts` | Current entry point to adapt |
| `dot/src/services/CommandRunner.ts` | Pattern to replace with Effect service |
| `dot/src/tui/App.ts` | App shell to integrate OutputPane into |
| `dot/src/types.ts` | Existing domain types |
| `dot/src/flags.ts` | Existing CLI parser to extend |
| `dot/package.json` | Build config to update |
| `.stowrc` | Stow ignore rules |
| `zsh/.zshrc` | Contains `dot()` wrapper to remove |

---

## Suggested Skills

- `effect` — Effect v4 service design, Layer, PubSub, Stream, acquireRelease
- `opentui` — OpenTUI renderer API, ScrollBoxRenderable, suspend/resume
- `dotfiles-stow` — Stow workflow (edit source paths, run `dot stow`)
- `types-enforce-ts` — TypeScript type safety

---

## Constraints

- Everything must be Effect services — no plain objects, no module singletons
- Edit stow source paths, not live paths
- The compiled binary must be self-contained (`bun build --compile`)
- UK spelling for human-facing prose
- Existing TUI views (DiffView, StagingView, CommitView, etc.) must continue working
