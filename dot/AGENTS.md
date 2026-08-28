# dot

Compiled CLI for the dotfiles manager, built with Bun and Effect v4.

## Scope

This directory (`~/.config/dotfiles/dot/`) contains the `dot` application source. It is excluded from stow via `--ignore=^/dot`; the compiled binary outputs to `../scripts/.local/bin/dot`, which is stowed to `~/.local/bin/dot`.

## Skills

Always apply these skills when editing code in this directory:

- `effect` for Effect v4 patterns
- `types-enforce-ts` for TypeScript type safety

## Documentation

- All exported functions, classes, interfaces, types, and interface members must have JSDoc comments.
- Effect service tags should reference the underlying service interface via `{@link}`.
- Use concise single-line JSDoc for simple members and multi-line JSDoc for complex behaviour.

## Stack

- Runtime and package manager: Bun
- Services: Effect 4.x (`Context.Service`, `Layer`, `Stream`, `Schedule`)
- Build: `bun build --compile` producing a single binary

## Architecture

```text
src/
  index.ts                - CLI parsing, command dispatch, and Effect bootstrap
  types.ts                - Shared domain types
  flags.ts                - CLI parser
  cli/
    spec.ts               - Command and flag metadata
    help.ts               - Help rendering
  commands/               - Native dot command implementations
  doctor/                 - Health-check runner and checks
  git/                    - Git and GitHub commands and services
  mcp/                    - MCP config generation
  services/
    Config.ts             - Dotfiles paths and environment config
    CommandExecutor.ts    - Process execution service
    Launcher.ts           - High-level process execution and output routing
    OutputLog.ts          - CLI logging, spinners, and run logs
  lib/                    - Shared command support
```

### Data Flow

1. `index.ts` parses flags and validates the command against `src/cli/spec.ts`.
2. Bare `dot` and `dot --help` print root help.
3. Native commands run through the shared Effect layer stack.
4. Command implementations use `Launcher`, `CommandExecutor`, and `OutputLog` for process and output handling.

### Key Patterns

- Services use `Context.Service` with a static `layer` property.
- Domain failures use `Schema.TaggedErrorClass`.
- Use `Effect.fn("Name")` for effectful functions with arguments.
- Use `Effect.gen` with `Effect.withSpan("Name")` for named zero-argument effects.
- Use `Clock.currentTimeMillis` for testable timestamps.
- Top-level execution uses `Effect.runPromise`.

## CLI

Command and flag metadata lives in `src/cli/spec.ts`. Help rendering, completion generation, known-command detection, and native command recognition consume that registry.

When changing a command, alias, or flag:

1. Update `src/cli/spec.ts`.
2. Rebuild with `mise run dot:build`.
3. Run `dot completions fish` and `dot completions zsh`.
4. Regenerate the command reference with `mise run docs:gen:cli`.

The generated command reference is `../docs/src/content/docs/dot/commands.md`. The `dot-build` workflow checks that it is current.

## Build

The root `mise.toml` owns all tasks. Use:

```bash
mise run dot:install
mise run dot:build
mise run dot:typecheck
mise run dot:test
mise run dot:format
mise run dot:check
```

The package manager is Bun. The tracked lockfile is `bun.lock`, and CI runs `bun install --frozen-lockfile`.

`dot update` compiles to a temporary path and atomically renames the result over the running binary to avoid `ETXTBSY`. Keep that behaviour when changing self-update code.

## Validation

After every final code change, run:

```bash
mise run dot:format
mise run dot:check
mise run dot:build
```

When command metadata changes, also regenerate docs and completions, then run repository smoke tests.

Manual checks:

```bash
dot
dot --help
dot git-diff
dot git-diff --bar-json
dot git-commit --help
dot git-notifications --raw
dot doctor
dot init --help
```

## Logging Style

- Section headings use Title Case.
- Log labels are uppercase (`[INFO]`, `[WARN]`, `[ERROR]`).
- Message text uses sentence case.

## Debugging

Run with stderr visible to inspect startup logging:

```bash
DOT_DEBUG=1 dot 2>/tmp/dot.log
```

Debug lines are prefixed with `[dot]`.
