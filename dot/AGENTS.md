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

```text
src/
  index.ts                — Entry point, CLI mode resolution, Effect bootstrap
  types.ts                — Repo, RepoState, MenuItem, MenuAction, ViewId, StagedFile
  flags.ts                — CLI parser: subcommands, --tab, --since, --raw, --help
  menu.ts                 — Menu registry: Map<string, MenuItem> for dot + omarchy items
  theme.ts                — Theme loading (Omarchy theme → TUI colours)
  commands/
    Init.ts               — dot init first-use setup workflow
    Install.ts            — dot install
    Update.ts             — dot update
    Stow.ts               — dot stow
    Doctor.ts             — dot doctor
    Clean.ts              — dot clean
    AgentsSync.ts         — dot agents-sync
    SetupPrivateRepo.ts   — dot setup-private-repo
    PrivatePkgPublish.ts  — dot private-pkg-publish
    SkillUpdates.ts       — dot skill-updates
    SkillCheck.ts         — dot skill-check
    OmarchyPlugin.ts      — managed Omarchy plugin add/update/remove lifecycle
    Completions.ts        — dot completions generator for stowed shell completions
    Usage.ts              — dot usage: local-first analytics (summary/stale/path/backfill)
    WorkspaceRelayout.ts  — apply/capture validated Hyprland Dwindle split trees
    Help.ts               — dot help
  mcp/
    commands/McpSync.ts   — dot mcp-sync: regenerate harness MCP configs from the spec
    sync/spec.ts          — MCP sync spec types, stub-harness notes, pure helpers
    sync/loadSpec.ts      — Load/validate the private mcp.yml spec
    sync/adapters.ts      — Per-harness entry shaping and OpenCode tools-gate keys
    sync/formatJson.ts    — Prettier-style JSON serialiser for generated configs
  doctor/
    types.ts              — DoctorCheck, DoctorResult types
    runner.ts             — Parallel check runner with output formatting
    checks/               — Doctor check modules (dependencies, repos, packages, etc.)
  git/
    commands/
      Commit.ts           — dot git-commit (guarded gateway: message validation, --path, --push, --dry-run)
      Diff.ts             — dot git-diff (--bar-json, --list-changed, --list-all, --raw)
      Notifications.ts    — dot git-notifications (--bar-json, --list-threads, actions, --raw)
    remotes.ts            — Shared default-remote/branch resolver for git helpers
    doctor/
      gitConfig.ts        — managed Git config doctor check
      originHead.ts       — stale local origin/HEAD doctor check (default-branch ref freshness)
    services/
      DotDiff.ts          — Effect service wrapping git diff state
      GitHub.ts           — Shared GitHub CLI/API wrapper with rate-limit checks and retries
      GitNotifications.ts — GitHub notification inbox state and thread actions
      GitStaging.ts       — Git status/add/commit operations
      RepoWatcher.ts      — Hybrid poll loop (initial poll → 10s poll), PubSub state
      relativeTime.ts     — Shared compact relative timestamp formatter
    tui/
      DiffView.ts         — Two-pane layout (Changed/Other) with repo watcher
      GitNotificationsView.ts — GitHub notification inbox with read/done/ignore actions
      Lazygit.ts          — Suspend/resume lazygit spawn
      SuspendedCommand.ts — Shared suspend/resume inherited-stdio command helper
  services/
    Config.ts             — Dotfiles paths, env config
    CommandExecutor.ts    — Shell command execution Effect service
    CommandRunner.ts      — Suspend/resume + silent + notify command execution (plain object)
    Launcher.ts           — Process lifecycle (exit handling)
    OutputLog.ts          — Scrollable output log service
    Renderer.ts           — OpenTUI renderer service
    Toast.ts              — Toast notification overlay service
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
    initState.ts          — First-use setup state marker helpers
    packageSetup.ts       — Strict package and mise setup helpers for init/install
    selfUpdate.ts         — Binary rebuild logic
    skillCheck.ts         — Skill reference validation logic
    skillUpdates.ts       — Skill update checking/applying logic
    stowFolders.ts        — Stow folder discovery
    usage.ts              — Usage event schema + NDJSON recorder (installUsageHook, readAllEvents)
    usageHistory.ts       — Shell-history backfill (fish/zsh parse, whitelist)
```

### Data Flow

1. `index.ts` parses CLI flags → resolves mode (TUI / native / fallback)
2. Native commands run with `CliLayers` (no renderer, no TUI)
3. TUI mode composes full layer stack including RepoWatcher, GitNotifications, Renderer, Toast
4. `App` manages a view stack (main menu ↔ diff view ↔ notifications view ↔ omarchy menu)
5. Menu items have typed actions: `command` (suspend/resume), `silent` (background), `notify` (background + toast), `view` (navigate), `submenu` (nested)
6. `CommandRunner` handles suspend/resume for terminal commands, silent background execution, and notify-style commands with toast feedback
7. `RepoWatcher` runs an initial poll for first paint, then polls every 10s

### Menu Registry

`menu.ts` exports:

- `mainMenuItems` — top-level dot menu items (update, stow, diff, doctor, etc.)
- `submenus` — `Map<string, MenuItem[]>` for all omarchy submenus
- `menuItemsById` — flat lookup of every item by its stable ID
- `submenuTitles` — display titles for submenu breadcrumbs

MenuItem action types:

- `command` — suspend TUI, run command, optional "press any key" wait, resume
- `exit-command` — destroy TUI, then run command as a normal CLI process
- `silent` — run in background, no TUI interruption
- `notify` — run in background with toast progress/success feedback
- `view` — navigate to a sub-view (diff, omarchy)
- `submenu` — open a nested submenu within the omarchy tree
- `quit` — exit the TUI

### Key Patterns

- **Services**: `Context.Service` + static `layer` property for Effect services
- **Static layers**: Each service class exposes `ServiceName.layer` (not a separate `*Live` export). Layer is built with `Layer.effect(ServiceName, Effect.gen(...))`
- **Domain errors**: `Schema.TaggedErrorClass` per service (`DotDiffError`, `GitStagingError`)
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

Command and flag metadata lives in `src/cli/spec.ts`. Help rendering,
completion generation, known-command detection, and native command recognition
consume that registry. When changing any command, subcommand, alias, or flag,
update the command spec and run `dot completions` for each supported shell after
rebuilding the binary so stowed shell completion files are regenerated before
stow.

`spec.ts` is also the source for the docs command reference at
`docs/src/content/docs/dot/commands.md`. After changing the spec, regenerate it
with `bun run gen:cli` in `../docs` (alongside shell completions) and commit
the result. The `tui-build` workflow regenerates it and fails when the committed
copy differs.

```text
dot                           # Main menu (TUI)
dot init                      # One-time first-use setup; logs to ~/.local/state/dot/init.log
dot init --noninteractive          # First setup without the host questionnaire
dot init --host laptop --noninteractive # First setup with laptop host overrides
dot init --log ~/Public/init.log # First setup with an explicit log path
dot install                   # Ensure prerequisites, then backup/adopt install flow
dot update                    # Full update (install deps, rebuild, restart, pull, trust mise configs, stow, init-state backfill)
dot update --pull             # Pull repos only
dot update --stow             # Generate completions, sync MCP configs, and stow only
dot update --app              # Install deps and rebuild binary only
dot update --check            # Report core/system repos behind upstream (no update); exit 10 if any
dot update --check-all        # Report all tracked repos behind upstream (no update); exit 10 if any
dot stow                      # Stow public + private
dot stow --public             # Stow public only
dot stow --private            # Stow private only
dot firewall                  # Reconcile managed ufw rules and comments
dot doctor                    # Health checks
dot doctor --open-opencode    # Health checks + OpenCode analysis
dot clean                     # Unstow private then public
dot git-diff                  # Diff view (TUI)
dot git-diff --tab other      # Diff view, Other tab focused (TUI)
dot git-diff --repo dotfiles  # Open a changed repo directly in lazygit, then resume the TUI
dot diff                      # Short alias for git-diff
dot git-diff --raw            # CLI diff output (no TUI)
dot git-diff --bar-json       # JSON output for status bars and shell modules
dot git-diff --list-changed   # Changed repo rows
dot git-diff --list-all       # All repo rows
context git                   # Branch context: repo/branch/PR summary, ahead/behind, unstaged, staged, untracked, branch files, recent commits, and optional JSON output; MCP is via `context mcp`
dot git-commit -m "msg"       # Guarded commit gateway: validates a single-line subject, commits the staged set
dot git-commit -m "msg" --path src/x.ts # Commit only the named file(s) (repeatable), never git add -A
dot git-commit --amend                # Amend the previous commit, keeping its message (folds in staged changes)
dot git-commit --amend -m "msg"       # Amend the previous commit and reword its subject
dot git-commit -m "msg" --push # Commit then push the current branch (pulls --rebase first, sets upstream when missing, never forces)
dot git-commit -m "msg" --dry-run # Preview the commit/push plan without changing anything
dot git-notifications         # GitHub notification inbox view (TUI)
dot git-notifications --raw   # CLI notification summary
dot git-notifications --bar-json # JSON output for status bars and shell modules
dot git-notifications --list-threads # Notification thread rows
dot git-notifications --mark-read <id> # Mark a notification read
dot git-notifications --mark-bot-read --dry-run # Preview bot notifications to mark read
dot git-notifications --mark-bot-read # Mark unread bot notifications read
dot git-notifications --mark-done <id> # Mark a notification done
dot git-notifications --ignore <id> # Ignore new notifications for a thread
dot git-notifications --unignore <id> # Stop ignoring a thread
dot agents-sync               # Mirror AGENTS.md to agent harness instruction files
dot mcp-sync                  # Regenerate MCP configs for all harnesses from the private spec
dot setup-private-repo        # Sync and register private pacman repo
dot private-pkg-publish <pkg> --install # Build, publish, and install a mapped private package
dot skill-updates             # Check/apply skill updates
dot skill-updates --check     # Check only (no apply)
dot skill-updates --update    # Auto-apply clean updates
dot skill-updates --skip-review # Skip local-edit review
dot skill-check               # Validate skill maintenance and adapted imports
dot completions zsh           # Generate stowed shell completions
dot usage                     # Per-feature dot usage summary
dot usage summary --format agent-context # Compact usage summary for agents
dot usage stale --days 90     # Features not used in the window
dot usage backfill --history  # Dry-run import from shell history (--apply to write)
dot omarchy-plugin update <id> # Update and validate a managed Omarchy plugin
dot workspace-relayout        # Apply a saved layout to the active workspace
dot workspace-relayout --edit # Capture the current layout into a preset
dot omarchy                   # Omarchy submenu (TUI)
dot help                      # Show help
dot --help                    # Show help
```

## Build

```bash
cd ~/.config/dotfiles
mise run dot:build   # outputs to scripts/.local/bin/dot (wraps bun run build)
```

The single root `mise.toml` defines the dev tasks, including the root `lint` task and namespaced `dot:*` tasks (`dot:install`, `dot:build`, `dot:dev`, `dot:typecheck`, `dot:test`, `dot:format`, `dot:format:check`, `dot:check`) with `dir = "dot"`; each wraps the matching `bun run` script, so `bun run build` still works for the fresh-machine bootstrap. `dot:build` depends on `dot:install`, and `dot:check` runs anti-slop lint, type checking, tests, and the format check. CI runs these via `mise run`. Run `mise tasks` to list them.

Tests live under `tests/` alongside `src/` and mirror the source tree.

The build is also triggered by `dot update`, which runs `bun install` before compiling the binary. `dot update`'s rebuild (`src/lib/selfUpdate.ts`) intentionally does **not** use the `build` task: it compiles to a temp path and atomically renames over the running binary to avoid `ETXTBSY`, which a direct `--outfile` over the live binary would hit.

Fresh-machine bootstrap uses system mise to trust the repo config, install the pinned Bun, and run the build task (which installs dependencies first) before `dot init` can manage global tool versions:

```bash
yay -S --needed git mise-bin
cd ~/.config/dotfiles
mise trust
mise install
mise run dot:build
```

After that bootstrap build, run the checked-out binary directly. If private dotfiles are wanted, authenticate `gh` before `dot init`; init clones `timmo001/dotfiles-private` to `~/.config/dotfiles-private` when `gh auth status` works. `dot init` installs stow if needed, stows public/private configs, runs `mise install`, and only then installs managed Arch/AUR package lists, so stowed mise config owns Bun, Node, pnpm, and similar tools for ongoing use.

## External Dependencies

- `NOTES` / `DOT_NOTES_DIR` — notes vault used by the standalone `notes` CLI/MCP server and OpenCode note commands
- `DOT_USAGE_DIR` — usage event root for `dot usage` (default `$XDG_STATE_HOME/tool-usage`). `DOT_USAGE_DISABLE` disables live dot recording
- `~/.config/dotfiles-private/dot-git.yml` — private git repo config for clone/bootstrap, doctor checks, `dot git-diff`, and `dot git-notifications --bar-json`; `activity` and `notifications` each require explicit `enabled` plus 5-field cron `schedule` keys, and `notifications.bar.ignore_bot_activity` controls status-bar bot noise
- `gh` authenticated with a classic token carrying `notifications` or `repo` scope — required for `dot git-notifications` and its status-bar module
- `lazygit` — launched via suspend/resume on Enter in diff view
- `opencode` — CLI launched via suspend/resume for interactive sessions from the diff view
- `omarchy` — various subcommands for desktop management
- `system-health-check` — system diagnostics
- `topgrade` — system-wide package upgrades

## Validation

Always run type check, format, and build after every final code change:

```bash
cd ~/.config/dotfiles
mise run dot:check           # anti-slop lint + type check + tests + prettier format check
mise run dot:format          # format with prettier (required before every commit)
mise run dot:build           # compile binary
```

The underlying `bunx tsc --noEmit` / `bun run format` / `bun run build` commands remain valid equivalents.

### Effect language service

`@effect/tsgo` patches the TypeScript 7 native binary (`effect-tsgo patch` in `prepare`) so `mise run dot:typecheck` surfaces the official Effect v4 diagnostics inline. The plugin entry in `tsconfig.json` remains named `@effect/language-service` (Effect's stable plugin id). Effect errors fail the typecheck; warnings and messages stay advisory (`ignoreEffectWarningsInTscExitCode` is set), so keep them visible but non-blocking. Editors pick up the diagnostics through the TypeScript Native Preview language server when `typescript.native-preview.tsdk` points at the workspace `typescript` install.

Dependency note: the tracked lockfile is `bun.lock` (committed, matching the `docs/` package). CI runs `bun install --frozen-lockfile` against it. After changing dependencies with `bun add`/`bun update`, commit the regenerated `bun.lock`, otherwise the CI frozen install fails.

Manual post-build checks:

```bash
dot                          # main menu renders, Ctrl+c quits
dot git-diff                 # diff view renders
dot git-diff --raw           # CLI diff output
dot git-diff --bar-json      # JSON output
dot git-commit --help        # gateway help prints without side effects
dot git-commit --dry-run -m "Test subject" # dry-run plan, no commit
dot git-commit --amend --dry-run # amend plan (keep message), no commit
dot git-notifications --raw  # CLI notification output
dot git-notifications --bar-json # notification JSON output
dot doctor                   # health checks run
dot init --help              # init help prints without side effects
dot help                     # help prints
```

UWSM environment overrides are stowed from `uwsm/.config/uwsm/env.d/90-dotfiles`, while Quattro owns its defaults under `/usr/share`. `dot stow` removes the retired `timmo001/omarchy-uwsm` checkout without importing its generated migration files. Hyprland config is a stowed dotfiles package (`hypr/.config/hypr/`) laid down with `--no-folding`, with the runtime `~/.config/hypr/host` symlink selecting the host overrides. Ghostty config is also stowed from `ghostty/.config/ghostty/`; `dot stow` backs up the retired `timmo001/omarchy-ghostty` clone before linking the stowed config.

## Logging Style

Keep logging readable and consistent:

- Section headings in Title Case
- Log labels uppercase (`[INFO]`, `[WARN]`, `[ERROR]`)
- Message text in sentence case

## Shell Helpers

Current shell helpers still used by the TS app or systemd units:

- `dot-doctor-notify` — doctor notification helper

## Debugging

Run with stderr visible to see startup logging:

```bash
DOT_DEBUG=1 dot 2>/tmp/dot.log
# or
DOT_DEBUG=1 dot 2>&1 | less
```

Debug log lines are prefixed with `[dot]`.
