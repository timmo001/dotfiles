# dot

Full TUI dashboard and CLI for `dot` — the dotfiles manager. Built with Effect v4 and OpenTUI.

## Scope

This directory (`~/.config/dotfiles/dot/`) contains the `dot` application source. It lives inside the public dotfiles repo but is excluded from stow via `--ignore=^/dot` in `.stowrc`. The compiled binary outputs to `../scripts/.local/bin/dot` which IS stowed to `~/.local/bin/dot`.

## Skills

Always apply these skills when editing code in this directory:

- `effect` — Effect v4 / effect-smol patterns
- `opentui` — OpenTUI core imperative API, renderables, keyboard, suspend/resume
- `types-enforce-ts` — TypeScript type safety

## Documentation

- All exported functions, classes, interfaces, types, and interface members must have JSDoc comments.
- Effect service tags should reference the underlying service interface via `{@link}`.
- Use concise single-line JSDoc for simple members; multi-line for functions with complex behaviour.

## Stack

- **Runtime**: Bun
- **UI**: `@opentui/core` (imperative API — no React/Solid)
- **Services**: `effect` 4.x (`Context.Service`, `Layer`, `PubSub`, `Stream`, `Schedule`)
- **Build**: `bun build --compile` producing a single binary

## Architecture

```
src/
  index.ts                — Entry point, CLI mode resolution, Effect bootstrap
  types.ts                — Repo, RepoState, MenuItem, MenuAction, ViewId, StagedFile, CommitSuggestion
  flags.ts                — CLI parser: subcommands, --tab, --since, --raw, --help
  menu.ts                 — Menu registry: Map<string, MenuItem> for dot + omarchy items
  theme.ts                — Theme loading (Omarchy theme → TUI colours)
  commands/
    AgentsSync.ts         — dot agents-sync
    Clean.ts              — dot clean
    Doctor.ts             — dot doctor
    Help.ts               — dot help
    Install.ts            — dot install
    OpencodeDebug.ts      — dot opencode-debug
    Setup.ts              — dot setup
    SkillCheck.ts         — dot skill-check
    SkillUpdates.ts       — dot skill-updates
    Stow.ts               — dot stow
    Update.ts             — dot update
  notes/
    types.ts              — Repo-note data types and legacy label formatting
    commands/Notes.ts     — dot notes / dot note native CLI handlers
    services/Notes.ts     — Effect service for OpenCode notes context and note I/O
    tui/NotesView.ts      — Two-pane repo notes browser with markdown preview
  doctor/
    types.ts              — DoctorCheck, DoctorResult types
    runner.ts             — Parallel check runner with output formatting
    checks/               — Doctor check modules (dependencies, repos, packages, etc.)
  git/
    commands/
      Diff.ts             — dot git-diff (--waybar, --list-changed, --list-all, --raw)
      Notifications.ts    — dot git-notifications (--waybar, --list-threads, actions, --raw)
      Workflows.ts        — dot git-workflows (--since, --waybar, --list-repos, --list-runs, --raw)
    doctor/
      gitConfig.ts        — managed Git config doctor check
    services/
      DotDiff.ts          — Effect service wrapping git diff state
      GitHub.ts           — Shared GitHub CLI/API wrapper with rate-limit checks and retries
      GitNotifications.ts — GitHub notification inbox state and thread actions
      GitStaging.ts       — Git status/add/reset/commit operations
      RepoWatcher.ts      — Hybrid poll loop (Waybar cache → 10s poll), PubSub state
      WorkflowRuns.ts     — Watched GitHub Actions run state for locally checked-out HEAD commits
      workflowStatus.ts   — Shared GitHub Actions status classification helpers
    tui/
      DiffView.ts         — Two-pane layout (Changed/Other) with repo watcher
      GitNotificationsView.ts — GitHub notification inbox with read/done/ignore actions
      WorkflowRunsView.ts — Two-pane watched GitHub workflow runs view
      Lazygit.ts          — Suspend/resume lazygit spawn
      StagingView.ts      — Two-pane staging view (Staged/Unstaged) for git commit flow
      CommitView.ts       — Commit message input with AI suggestion list
  services/
    Config.ts             — Dotfiles paths, env config
    CommandExecutor.ts    — Shell command execution Effect service
    CommandRunner.ts      — Suspend/resume + silent + notify command execution (plain object)
    CommitSuggest.ts      — AI commit suggestions via OpenCode SDK
    Launcher.ts           — Process lifecycle (exit handling)
    ModelDiscovery.ts     — OpenCode model discovery
    OpenCodeServer.ts     — OpenCode server lifecycle
    OutputLog.ts          — Scrollable output log service
    Renderer.ts           — OpenTUI renderer service
    Toast.ts              — Toast notification overlay service
    WaybarCache.ts        — Waybar cache JSON reader for fast startup
  tui/
    App.ts                — Top-level app shell, view stack, global keyboard, action routing
    MainMenu.ts           — MenuList menu built from menu registry
    MenuList.ts           — Reusable menu list renderable
    OmarchyMenu.ts        — Inline omarchy submenu tree with breadcrumb navigation
    VariantPopup.ts       — Centred popup overlay for menu item variant selection
    OutputPane.ts         — Scrollable command output pane
    Toast.ts              — Toast renderable
    breadcrumb.ts         — Breadcrumb navigation helper
    helpBar.ts            — Bottom help bar renderable
    hyprland.ts           — Hyprland window resize utility
    paneTitle.ts          — Shared two-pane title formatter
  lib/
    extractNativeLib.ts   — Native .so extraction from bunfs
    selfUpdate.ts         — Binary rebuild logic
    skillCheck.ts         — Skill reference validation logic
    skillUpdates.ts       — Skill update checking/applying logic
    stowFolders.ts        — Stow folder discovery
```

### Data Flow

1. `index.ts` parses CLI flags → resolves mode (TUI / native / fallback)
2. Native commands run with `CliLayers` (no renderer, no TUI)
3. TUI mode composes full layer stack including RepoWatcher, WorkflowRuns, GitNotifications, GitStaging, CommitSuggest, Renderer, Toast
4. `App` manages a view stack (main menu ↔ diff view ↔ workflows view ↔ notifications view ↔ notes view ↔ omarchy menu ↔ staging view ↔ commit view)
5. Menu items have typed actions: `command` (suspend/resume), `silent` (background), `notify` (background + toast), `view` (navigate), `submenu` (nested)
6. `CommandRunner` handles suspend/resume for terminal commands, silent background execution, and notify-style commands with toast feedback
7. `RepoWatcher` loads Waybar cache for instant diff first paint, then polls every 10s

### Menu Registry

`menu.ts` exports:
- `mainMenuItems` — top-level dot menu items (update, stow, diff, doctor, etc.)
- `submenus` — `Map<string, MenuItem[]>` for all omarchy submenus
- `menuItemsById` — flat lookup of every item by its stable ID
- `submenuTitles` — display titles for submenu breadcrumbs

MenuItem action types:
- `command` — suspend TUI, run command, optional "press any key" wait, resume
- `silent` — run in background, no TUI interruption
- `notify` — run in background with toast progress/success feedback
- `view` — navigate to a sub-view (diff, omarchy)
- `submenu` — open a nested submenu within the omarchy tree
- `quit` — exit the TUI

### Key Patterns

- **Services**: `Context.Service` + static `layer` property for Effect services
- **Static layers**: Each service class exposes `ServiceName.layer` (not a separate `*Live` export). Layer is built with `Layer.effect(ServiceName, Effect.gen(...))`
- **Domain errors**: `Schema.TaggedErrorClass` per service (`DotDiffError`, `GitStagingError`, `CommitSuggestError`). WaybarCache has no error type
- **Error handling**: `Effect.catch` (v4 rename of `catchAll`) for recovery; tagged errors flow through the type channel
- **Named spans**: `Effect.fn("Name")` for effectful functions with arguments; `Effect.gen` + `Effect.withSpan("Name")` for zero-arg named effects (since `Effect.fn` returns a function, not an Effect)
- **Testable time**: `Clock.currentTimeMillis` for timestamps instead of `new Date()`
- **CommandRunner**: Plain object (not Effect service) — passed directly to App to avoid scope issues with `Effect.runFork`
- **Concurrency**: `Effect.forkScoped` for background poll fiber
- **Top-level run**: `Effect.runPromise` (keeps process alive)
- **Suspend/resume**: `renderer.suspend()` → `Bun.spawn` → `renderer.resume()` for commands and lazygit
- **View switching**: `BoxRenderable.visible` property to show/hide views without destroying them
- **Navigation**: View stack with `pushView()`/`popView()`, Escape/Backspace returns to parent

## CLI

```
dot                           # Main menu (TUI)
dot git-diff                  # Diff view (TUI)
dot git-diff --tab other      # Diff view, Other tab focused (TUI)
dot diff                      # Short alias for git-diff
dot git-workflows             # Watched GitHub workflow runs view (TUI)
dot git-notifications         # GitHub notification inbox view (TUI)
dot notes                     # Repository notes browser (TUI)
dot handoffs                  # Handoff notes browser (TUI, tag: handoff)
dot handoff                   # Alias for dot handoffs
dot git-diff --raw            # CLI diff output (no TUI)
dot git-diff --waybar         # JSON output for Waybar
dot git-diff --list-changed   # Changed repo rows
dot git-diff --list-all       # All repo rows
dot git-workflows --raw       # CLI workflow run summary
dot git-workflows --since <date> # Filter workflow runs by creation time (TUI or CLI)
dot git-workflows --waybar    # JSON output for Waybar
dot git-workflows --list-repos # Watched repo rows
dot git-workflows --list-runs # Workflow run rows
dot git-notifications --raw   # CLI notification summary
dot git-notifications --waybar # JSON output for Waybar
dot git-notifications --list-threads # Notification thread rows
dot git-notifications --mark-read <id> # Mark a notification read
dot git-notifications --mark-done <id> # Mark a notification done
dot git-notifications --ignore <id> # Ignore future notifications for a thread
dot git-notifications --unignore <id> # Stop ignoring a thread
dot notes root             # Print notes vault root (CLI)
dot notes root --repo-notes # Print repository notes directory (CLI)
dot notes context --command notes-list # Print OpenCode notes context (CLI)
dot notes list --format json # List current repo notes as JSON (CLI)
dot note read --path <path> # Read a note file
dot note write --path <path> --stdin # Write stdin to a note file and commit it
dot note delete --path <path> # Delete a note file and commit it
dot update                    # Full update (pull, stow, rebuild)
dot update --pull             # Pull repos only
dot update --stow             # Stow only
dot update --tui              # Rebuild binary only
dot stow                      # Stow public + private
dot stow --public             # Stow public only
dot stow --private            # Stow private only
dot doctor                    # Health checks
dot doctor --open-opencode    # Health checks + OpenCode analysis
dot help                      # Show help
dot clean                     # Unstow private then public
dot agents-sync               # Sync AGENTS.md to Cursor rule
dot opencode-debug            # Debug OpenCode config
dot opencode-debug --agent x  # Debug specific agent
dot install                   # Backup/adopt install flow
dot setup                     # Package install step
dot skill-updates             # Check/apply skill updates
dot skill-updates --check     # Check only (no apply)
dot skill-updates --update    # Auto-apply clean updates
dot skill-updates --skip-review # Skip local-edit review
dot skill-check               # Validate skill references
dot omarchy                   # Omarchy submenu (TUI)
dot --help                    # Show help
```

## Build

```bash
cd ~/.config/dotfiles/dot
bun run build    # outputs to ../scripts/.local/bin/dot
```

The build is also triggered by `dot update`.

## Keybindings

### Main Menu
| Key | Action |
|-----|--------|
| `↑↓` / typing | Navigate/filter list |
| `Enter` | Select item (opens variant popup if variants exist) |
| `Ctrl+c` | Quit |

### Workflows View
| Key | Action |
|-----|--------|
| `↑↓` | Navigate active pane |
| `Tab` | Switch between Repos/Runs pane |
| `Enter` | Focus runs from Repos, open selected run from Runs |
| `r` | Refresh workflow runs |
| `Esc/Backspace` | Back to main menu |
| `Ctrl+c` | Quit |

### Notifications View
| Key | Action |
|-----|--------|
| `↑↓` | Navigate notifications |
| `Enter` | Open selected notification in browser |
| `w` | Open GitHub notifications inbox |
| `r` | Refresh notifications |
| `m` | Mark selected thread read |
| `d` | Mark selected thread done |
| `i` | Ignore selected thread |
| `u` | Unignore selected thread |
| `Esc/Backspace` | Back to main menu |
| `Ctrl+c` | Quit |

### Notes View
| Key | Action |
|-----|--------|
| `↑↓` | Navigate notes or scroll content |
| `Tab` | Switch between list/content panes |
| `Enter` | Focus note preview from the list |
| `o` | Open selected note in a full OpenCode session |
| `r` | Refresh notes |
| `d` | Delete selected note after confirmation |
| `Esc/Backspace` | Back to main menu |
| `Ctrl+c` | Quit |

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
| `t` | Open tmux session (Changed pane opens changed repos, Other pane opens all repos) |
| `o` | Open terminal in selected repo directory |
| `w` | Open selected repo on GitHub in browser |
| `r` | Manual refresh |
| `Esc/Backspace` | Back to main menu |
| `Ctrl+c` | Quit |

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
| `Ctrl+c` | Quit |

### Commit View
| Key | Action |
|-----|--------|
| `Ctrl+s` | Request AI commit message suggestions |
| `Tab` | Switch between input and suggestion list |
| `Enter` | Commit (on input) or select suggestion (on list) |
| `Esc` | Hide suggestions / back to staging view |
| `Ctrl+c` | Quit |

### Omarchy Menu
| Key | Action |
|-----|--------|
| `↑↓` | Navigate list |
| `Enter` | Select item / enter submenu |
| `Esc/Backspace` | Back to parent menu |
| `Ctrl+c` | Quit |

## External Dependencies

- `~/.cache/waybar/git-diff-waybar.json` — Waybar cache for fast startup
- `NOTES` / `DOT_NOTES_DIR` — notes vault used by `dot notes` and OpenCode note commands
- `~/.config/dotfiles-private/.git-workflow-watch-repos` — watched GitHub repos for `dot git-workflows`; `dot git-workflows` applies matching `.dot-extra-repos` schedules before querying GitHub, hides disabled workflows, and supports `--since <date>` for activity-time filtering
- `gh` authenticated with a classic token carrying `notifications` or `repo` scope — required for `dot git-notifications` and its Waybar module
- `lazygit` — launched via suspend/resume on Enter in diff view
- `opencode` — CLI for model discovery; SDK for AI commit suggestions
- `@opencode-ai/sdk` — OpenCode SDK for programmatic session/prompt calls
- `omarchy` — various subcommands for desktop management
- `system-health-check` — system diagnostics
- `topgrade` — system-wide package upgrades

## Validation

Always run type check, format, and build after every final code change:

```bash
cd ~/.config/dotfiles/dot
bunx tsc --noEmit            # type check
bun run format               # format with prettier (required before every commit)
bun run build                # compile binary
```

For dead-code analysis, use the MCP `analyze` tool with `root: dot`, or `/fallow-audit`.

Smoke tests:
```bash
dot                          # smoke test: main menu renders, Ctrl+c quits
dot git-diff                 # smoke test: diff view renders
dot git-diff --raw           # smoke test: CLI diff output
dot git-diff --waybar        # smoke test: JSON output
dot git-notifications --raw  # smoke test: CLI notification output
dot git-notifications --waybar # smoke test: notification JSON output
dot notes                    # smoke test: notes view renders
dot handoffs                 # smoke test: handoff-filtered notes view renders
dot doctor                   # smoke test: health checks run
dot help                     # smoke test: help prints
```

## Logging Style

Keep logging readable and consistent:
- Section headings in Title Case
- Log labels uppercase (`[INFO]`, `[WARN]`, `[ERROR]`)
- Message text in sentence case

## Legacy Bash Script

`scripts/.local/bin/dot-legacy` is the original bash implementation. It remains in place as a reference for debugging behaviour differences or understanding the original logic for a given command, and can still be invoked directly (e.g. `dot-legacy init`). The TS binary no longer falls back to it — unknown subcommands print an error and exit non-zero.

Related bash helpers (also still in place):
- `dot-lib` — shared shell functions
- `dot-cron-lib` — cron/timer helpers
- `dot-doctor-lib` — doctor check functions
- `dot-doctor-notify` — doctor notification helper
- `git-diff-tmux-session` — tmux session launcher for git diff
- `dot-omarchy-lib` — omarchy sync helpers
- `dot-private-pkg-lib` — private package repo helpers
- `dot-skill-updates-lib` — skill update checking logic

These will be removed in Phase 99 of the migration once all fallback paths are confirmed unused.

## Debugging

Run with stderr visible to see startup logging:
```bash
DOT_DEBUG=1 dot 2>/tmp/dot.log
# or
DOT_DEBUG=1 dot 2>&1 | less
```

Debug log lines are prefixed with `[dot]`.
