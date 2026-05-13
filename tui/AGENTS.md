# dot-tui

Full TUI dashboard for `dot` — the dotfiles manager. Replaces both `dot-menu` (walker GUI) and the old diff-only TUI.

## Scope

This directory (`~/.config/dotfiles/tui/`) contains the `dot-tui` application source. It lives inside the public dotfiles repo but is excluded from stow via `--ignore=^/tui` in `.stowrc`. The compiled binary outputs to `../scripts/.local/bin/dot-tui` which IS stowed to `~/.local/bin/dot-tui`.

## Skills

Always apply these skills when editing code in this directory:

- `effect-ts` — Effect service/layer/concurrency patterns (Effect 3.x, `Context.Tag`)
- `opentui` — OpenTUI core imperative API, renderables, keyboard, suspend/resume
- `types-enforce-ts` — TypeScript type safety

## Documentation

- All exported functions, classes, interfaces, types, and interface members must have JSDoc comments.
- Effect service tags should reference the underlying service interface via `{@link}`.
- Use concise single-line JSDoc for simple members; multi-line for functions with complex behaviour.

## Stack

- **Runtime**: Bun
- **UI**: `@opentui/core` (imperative API — no React/Solid)
- **Services**: `effect` 3.x (`Context.Tag`, `Layer`, `PubSub`, `Stream`, `Schedule`)
- **Platform**: `@effect/platform-bun` (available but not yet used heavily)
- **Build**: `bun build --compile` producing a single binary

## Architecture

```
src/
  index.ts                — Entry point, subcommand routing, Effect bootstrap
  types.ts                — Repo, RepoState, MenuItem, MenuAction, ViewId, StagedFile, CommitSuggestion
  flags.ts                — CLI parser: subcommands, --tab, --raw, --help
  menu.ts                 — Menu registry: Map<string, MenuItem> for dot + omarchy items
  services/
    DotDiff.ts            — Effect service wrapping `dot diff` shell commands
    WaybarCache.ts        — Effect service reading Waybar cache JSON for fast start
    RepoWatcher.ts        — Hybrid poll loop (Waybar cache → 10s poll), PubSub state
    CommandRunner.ts      — Suspend/resume + silent command execution
    GitStaging.ts         — Effect service for git status/add/reset/commit operations
    CommitSuggest.ts      — Effect service for AI commit suggestions via OpenCode SDK v2
  tui/
    App.ts                — Top-level app shell, view stack, global keyboard, action routing
    MainMenu.ts           — SelectRenderable menu built from menu registry
    DiffView.ts           — Two-pane layout (Changed/Other) with repo watcher
    OmarchyMenu.ts        — Inline omarchy submenu tree with breadcrumb navigation
    VariantPopup.ts       — Centred popup overlay for menu item variant selection
    Lazygit.ts            — Suspend/resume lazygit spawn
    StagingView.ts        — Two-pane staging view (Staged/Unstaged) for git commit flow
    CommitView.ts         — Commit message input with AI suggestion list
```

### Data Flow

1. `index.ts` resolves subcommand → initial view/action, creates renderer + services
2. `App` manages a view stack (main menu ↔ diff view ↔ omarchy menu ↔ staging view ↔ commit view)
3. Menu items have typed actions: `command` (suspend/resume), `silent` (background), `view` (navigate), `submenu` (nested)
4. Menu items with `variants` open a centred popup on Enter; selecting a variant dispatches its action
5. `CommandRunner` handles suspend/resume for terminal commands and silent background execution
5. `RepoWatcher` loads Waybar cache for instant diff first paint, then polls `dot diff` every 10s
6. State changes are published via `PubSub<RepoState>` → `DiffView.update()`

### Menu Registry

`menu.ts` exports:
- `mainMenuItems` — top-level dot menu items (update, stow, diff, doctor, etc.)
- `submenus` — `Map<string, MenuItem[]>` for all omarchy submenus
- `menuItemsById` — flat lookup of every item by its stable ID
- `submenuTitles` — display titles for submenu breadcrumbs

MenuItem action types:
- `command` — suspend TUI, run `bash -c <cmd>`, optional "press any key" wait, resume
- `silent` — run in background, no TUI interruption
- `view` — navigate to a sub-view (diff, omarchy)
- `submenu` — open a nested submenu within the omarchy tree

### Key Patterns

- **Services**: `Context.Tag` + `Layer` for Effect services (DotDiff, WaybarCache, RepoWatcher, GitStaging, CommitSuggest)
- **CommandRunner**: Plain object (not Effect service) — passed directly to App to avoid scope issues with `Effect.runFork`
- **Concurrency**: `Effect.forkScoped` for background poll fiber
- **Top-level run**: `Effect.runPromise` (keeps process alive)
- **Suspend/resume**: `renderer.suspend()` → `Bun.spawn` → `renderer.resume()` for commands and lazygit
- **View switching**: `BoxRenderable.visible` property to show/hide views without destroying them
- **Navigation**: View stack with `pushView()`/`popView()`, Escape/Backspace returns to parent

## CLI

```
dot-tui                       # Main menu
dot-tui diff                  # Diff view directly
dot-tui diff --tab other      # Diff view, Other tab focused
dot-tui update                # Run dot update directly (no TUI)
dot-tui stow                  # Run dot stow directly (no TUI)
dot-tui omarchy               # Omarchy submenu
dot-tui omarchy theme         # Omarchy theme submenu (space-separated)
dot-tui omarchy theme set     # Execute omarchy theme set directly
dot-tui --help                # Show help
dot-tui diff --help           # Diff-specific help
dot-tui omarchy --help        # Omarchy-specific help
```

Alias via `dot`:
```
dot                           # Launches dot-tui (main menu)
dot tui                       # Same as dot-tui
dot tui diff --tab other      # Same as dot-tui diff --tab other
dot diff                      # Launches dot-tui diff view
dot diff --raw                # Original CLI diff output (no TUI)
dot diff --waybar             # Machine-readable (unchanged)
```

## Build

```bash
cd ~/.config/dotfiles/tui
bun run build    # outputs to ../scripts/.local/bin/dot-tui
```

The build is also triggered by `dot update` via `maybe_build_tui()` in the `dot` script.

## Keybindings

### Main Menu
| Key | Action |
|-----|--------|
| `↑↓` | Navigate list |
| `Enter` | Select item (opens variant popup if variants exist) |
| `q` | Quit |

### Variant Popup
| Key | Action |
|-----|--------|
| `↑↓` | Navigate variant list |
| `Enter` | Run selected variant |
| `Esc/Backspace` | Dismiss popup (no action) |

### Diff View
| Key | Action |
|-----|--------|
| `↑↓` | Navigate list |
| `Tab` | Switch between Changed/Other pane |
| `Enter` | Open lazygit for selected repo |
| `c` | Open commit flow (staging → commit) for selected repo |
| `p` | Pull selected repo (`git pull --rebase --no-edit`) |
| `P` | Push selected repo (`git push`) |
| `t` | Open tmux session (changed repos if Changed pane, all repos if Other pane) |
| `o` | Open terminal in selected repo directory |
| `w` | Open selected repo on GitHub in browser |
| `r` | Manual refresh |
| `Esc/Backspace` | Back to main menu |
| `q` | Quit |

### Staging View
| Key | Action |
|-----|--------|
| `↑↓` | Navigate file list |
| `Tab` | Switch between Staged/Unstaged pane |
| `Space` | Toggle selected file between staged/unstaged |
| `a` | Stage all unstaged files |
| `l` | Open lazygit for the repo |
| `c`/`Enter` | Proceed to commit view (requires staged files) |
| `Esc/Backspace` | Back to diff view |
| `q` | Quit |

### Commit View
| Key | Action |
|-----|--------|
| `Ctrl+s` | Request AI commit message suggestions |
| `Tab` | Switch between input and suggestion list |
| `Enter` | Commit (on input) or select suggestion (on list) |
| `Esc` | Hide suggestions / back to staging view |
| `q` | Quit |

### Omarchy Menu
| Key | Action |
|-----|--------|
| `↑↓` | Navigate list |
| `Enter` | Select item / enter submenu |
| `Esc/Backspace` | Back to parent menu |
| `q` | Quit |

## External Dependencies

- `dot diff --list-all` — lists all tracked repos as `name|path` lines
- `dot diff --list-changed` — lists repos with uncommitted/unpushed changes
- `~/.cache/waybar/dot-diff-waybar.json` — Waybar cache for fast startup
- `lazygit` — launched via suspend/resume on Enter in diff view
- `opencode` — CLI for model discovery; SDK v2 for AI commit suggestions
- `@opencode-ai/sdk` — OpenCode SDK v2 for programmatic session/prompt calls
- `omarchy` — various subcommands for desktop management
- `system-health-check` — system diagnostics
- `topgrade` — system-wide package upgrades

## Validation

Always run type check, dead-code analysis, and build after every final code change:

```bash
cd ~/.config/dotfiles/tui
bunx tsc --noEmit            # type check
bun run format               # format with prettier
bun run build                # compile binary
```

For dead-code analysis, use the MCP `analyze` tool with `root: tui`, or `/fallow-audit`.

Smoke tests:
```bash
dot-tui                      # smoke test: main menu renders, q quits
dot-tui diff                 # smoke test: diff view renders
dot tui                      # smoke test: alias works
dot                          # smoke test: launches TUI
dot diff --raw               # smoke test: original CLI diff
```

## Debugging

Run with stderr visible to see startup logging:
```bash
dot-tui 2>/tmp/dot-tui.log
# or
dot-tui 2>&1 | less
```

All services emit `[dot-tui:*]` prefixed log lines to stderr.
