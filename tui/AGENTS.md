# dot-tui

OpenTUI + Effect TUI dashboard for watching git repos via `dot diff`.

## Scope

This directory (`~/.config/dotfiles/tui/`) contains the `dot-tui` application source. It lives inside the public dotfiles repo but is excluded from stow via `--ignore=^/tui` in `.stowrc`. The compiled binary outputs to `../scripts/.local/bin/dot-tui` which IS stowed to `~/.local/bin/dot-tui`.

## Skills

Always apply these skills when editing code in this directory:

- `effect-ts` — Effect service/layer/concurrency patterns (Effect 3.x, `Context.Tag`)
- `opentui` — OpenTUI core imperative API, renderables, keyboard, suspend/resume
- `types-enforce-ts` — TypeScript type safety

## Stack

- **Runtime**: Bun
- **UI**: `@opentui/core` (imperative API — no React/Solid)
- **Services**: `effect` 3.x (`Context.Tag`, `Layer`, `PubSub`, `Stream`, `Schedule`)
- **Platform**: `@effect/platform-bun` (available but not yet used heavily)
- **Build**: `bun build --compile` producing a single binary

## Architecture

```
src/
  index.ts              — Entry point, Effect bootstrap, wires watcher → dashboard
  types.ts              — Repo, RepoState interfaces
  services/
    DotDiff.ts           — Effect service wrapping `dot diff` shell commands
    WaybarCache.ts       — Effect service reading Waybar cache JSON for fast start
    RepoWatcher.ts       — Hybrid poll loop (Waybar cache → 10s poll), PubSub state
  tui/
    Dashboard.ts         — Two-pane layout (Changed/Other) with SelectRenderables
    Lazygit.ts           — Suspend/resume lazygit spawn
```

### Data Flow

1. `RepoWatcher` loads Waybar cache for instant first paint, then polls `dot diff` every 10s
2. State changes are published via `PubSub<RepoState>`
3. `index.ts` subscribes via `Stream.fromPubSub` and calls `dashboard.update(state)`
4. Dashboard renders two `SelectRenderable` panes with repo lists

### Key Patterns

- **Services**: `Context.Tag` + `Layer.succeed` (simple) or `Layer.effect` (with dependencies)
- **Concurrency**: `Effect.forkScoped` for background poll fiber (NOT `forkDaemon` — needs scope)
- **Top-level run**: `Effect.runPromise` (NOT `runFork` — keeps process alive)
- **Suspend/resume**: `renderer.suspend()` → `Bun.spawn` → `renderer.resume()` for lazygit

## Build

```bash
cd ~/.config/dotfiles/tui
bun run build    # outputs to ../scripts/.local/bin/dot-tui
```

The build is also triggered by `dot update` via `maybe_build_tui()` in the `dot` script.

## Keybindings

| Key | Action |
|-----|--------|
| `↑↓` | Navigate list |
| `Tab` | Switch between Changed/Other pane |
| `Enter` | Open lazygit for selected repo |
| `r` | Manual refresh |
| `q` | Quit |

## External Dependencies

- `dot diff --list-all` — lists all tracked repos as `name|path` lines
- `dot diff --list-changed` — lists repos with uncommitted/unpushed changes
- `~/.cache/waybar/dot-diff-waybar.json` — Waybar cache for fast startup
- `lazygit` — launched via suspend/resume on Enter

## Validation

```bash
cd ~/.config/dotfiles/tui
bunx tsc --noEmit            # type check
bun run build                # compile binary
dot-tui                      # smoke test (q to quit)
```

## Debugging

Run with stderr visible to see startup logging:
```bash
dot-tui 2>/tmp/dot-tui.log
# or
dot-tui 2>&1 | less
```

All services emit `[dot-tui:*]` prefixed log lines to stderr.
