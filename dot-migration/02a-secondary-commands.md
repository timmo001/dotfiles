# Handoff: Phase 2a — Secondary Commands (Simple)

## Focus

Port the simple secondary commands from bash to TypeScript Effect. `skill-updates` is broken out to its own handoff (Phase 2b) due to complexity.

---

## Prerequisites

- Phase 0 complete (foundation services)
- Phase 1 complete (core commands demonstrate the patterns)

---

## Commands to Port

### `dot help` (trivial)

Print usage text to stdout. No services needed beyond basic arg parsing.

```typescript
// dot/src/commands/Help.ts
export const help = Effect.sync(() => {
  process.stdout.write(`
dot — dotfiles manager

Usage: dot [command] [flags]

Commands:
  (none)           Open TUI menu
  update           Pull repos, stow, rebuild
  stow             Re-stow all packages
  diff             Show repository changes
  doctor           Health check
  install          Backup + stow
  clean            Unstow all packages
  init             First-time setup
  agents-sync      Sync AGENTS.md to Cursor rules
  skill-updates    Check skills for upstream changes
  opencode-debug   Debug OpenCode configuration
  setup            Install prerequisites
  help             Show this help

Flags:
  --help, -h       Show help for a command
`)
})
```

---

### `dot install` (simple)

Backup existing dotfiles, then stow. Reuses the `stow` command with a backup step.

```typescript
export const install = Effect.gen(function* () {
  const log = yield* OutputLog
  const launcher = yield* Launcher
  const config = yield* Config

  yield* log.section("Backup")
  // Backup is handled by stow --adopt (adopts existing files into repo)
  yield* log.info("Using --adopt to preserve existing files")

  yield* log.section("Install")
  yield* stow  // reuse Phase 1A
})
```

---

### `dot clean` (simple)

Unstow private then public.

```typescript
export const clean = Effect.gen(function* () {
  const log = yield* OutputLog
  const launcher = yield* Launcher
  const config = yield* Config

  if (config.canUsePrivate && config.privateDotfiles) {
    yield* log.section("Unstow Private")
    yield* launcher.stream("stow --delete --target=$HOME .", { cwd: config.privateDotfiles })
  }

  yield* log.section("Unstow Public")
  yield* launcher.stream("stow --delete --target=$HOME .", { cwd: config.publicDotfiles })

  yield* log.info("All packages unstowed")
})
```

---

### `dot init` (medium)

Interactive first-time setup. Uses `gum` for prompts (external subprocess — keep as subprocess calls).

Flow:
1. Ask which repos to clone (gum choose)
2. Clone selected repos
3. Ask about private dotfiles
4. Install packages
5. Stow

```typescript
export const init = Effect.gen(function* () {
  const log = yield* OutputLog
  const launcher = yield* Launcher

  yield* log.section("First-Time Setup")

  // Interactive prompts via gum (suspend TUI if in TUI mode)
  yield* launcher.suspend("gum confirm 'Set up public dotfiles?'")
  // ... etc

  // Or: if non-interactive, use defaults
})
```

For `init`, consider whether to keep the full interactive flow as a bash fallback initially, since it's rarely run and heavily uses `gum`.

---

### `dot agents-sync` (simple)

Reads `AGENTS.md`, writes a Cursor `.mdc` rule file.

```typescript
export const agentsSync = Effect.gen(function* () {
  const log = yield* OutputLog
  const config = yield* Config

  const agentsPath = `${config.publicDotfiles}/AGENTS.md`
  const content = yield* Effect.sync(() => Bun.file(agentsPath).text())

  // Determine output path (private dotfiles or default)
  const outputDir = config.canUsePrivate
    ? `${config.privateDotfiles}/agents/.cursor/rules`
    : `${config.publicDotfiles}/.cursor/rules`

  const mdc = `---\nalwaysApply: true\n---\n\n${content}`

  yield* Effect.sync(() => {
    Bun.mkdirSync(outputDir, { recursive: true })
    Bun.write(`${outputDir}/global-agents.mdc`, mdc)
  })

  yield* log.info(`Written to ${outputDir}/global-agents.mdc`)
})
```

---

### `dot opencode-debug` (simple)

Runs `opencode debug` subcommands, formats output.

```typescript
export const opencodeDebug = Effect.gen(function* () {
  const log = yield* OutputLog
  const launcher = yield* Launcher

  yield* log.section("OpenCode Debug")
  yield* launcher.stream("opencode debug config")
  yield* launcher.stream("opencode debug skills")
  yield* launcher.stream("opencode debug agents")
})
```

---

### `dot setup` (simple)

Install prerequisite packages for the dotfiles system to function.

```typescript
export const setup = Effect.gen(function* () {
  const log = yield* OutputLog
  const launcher = yield* Launcher

  yield* log.section("Installing Prerequisites")
  yield* launcher.stream("sudo pacman -S --needed stow git base-devel")
  yield* log.info("Prerequisites installed")
})
```

---

### `dot setup-private-repo` (medium, requires private)

Sets up the private pacman repository. Reference: `scripts/.local/bin/dot-private-pkg-lib`.

Keep as bash fallback initially (complex, rarely used). Port later if desired.

---

### `dot private-pkg-publish` (medium, requires private)

Builds and publishes packages to private repo. Reference: `scripts/.local/bin/dot-private-pkg-lib`.

Keep as bash fallback initially. Port later if desired.

---

## Suggested Order

1. `help` (trivial, immediate value)
2. `clean` (trivial, validates unstow path)
3. `agents-sync` (simple, frequently used)
4. `opencode-debug` (simple, frequently used)
5. `install` (reuses stow)
6. `setup` (simple but rarely used)
7. `init` (medium, rarely used — consider keeping as bash fallback)
8. `setup-private-repo` (keep as bash fallback)
9. `private-pkg-publish` (keep as bash fallback)

`skill-updates` is tracked separately in Phase 2b.

---

## Validation

After each command is ported:
```bash
bun run build
dot <command>  # verify it works
```

After all are ported, the bash fallback should never trigger for known commands.

---

## Key Files to Read

| Path | Why |
|------|-----|
| `scripts/.local/bin/dot-legacy` | Full bash script with all command logic |
| `scripts/.local/bin/dot-private-pkg-lib` | Private package logic |
| `dot/src/commands/Stow.ts` | Pattern to follow |

---

## Suggested Skills

- `effect` — Effect.gen, service patterns
- `types-enforce-ts` — Type safety
- `dotfiles-stow` — For commands that touch stow

---

## Constraints

- Every command is an Effect (no raw async/await, no imperative code outside Effect.sync)
- Commands that are rarely used and complex can stay as bash fallback (`BashFallback`)
- Log via OutputLog, not console.log
- Private-only commands check `config.canUsePrivate` and skip gracefully
