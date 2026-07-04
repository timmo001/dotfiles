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
  types.ts                — Repo, RepoState, GitLogState, MenuItem, MenuAction, ViewId, StagedFile, CommitSuggestion
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
    OpencodeDebug.ts      — dot opencode-debug
    SetupPrivateRepo.ts   — dot setup-private-repo
    PrivatePkgPublish.ts  — dot private-pkg-publish
    SkillUpdates.ts       — dot skill-updates
    SkillCheck.ts         — dot skill-check
    Completions.ts        — dot completions generator for stowed shell completions
    Help.ts               — dot help
  notes/
    types.ts              — Repo-note data types and legacy label formatting
    commands/Notes.ts     — dot notes / dot note native CLI handlers
    services/Notes.ts     — Effect service for OpenCode notes context and note I/O
    tui/NotesView.ts      — Two-pane repo notes browser with markdown preview
  mcp/
    server.ts             — dot mcp stdio server layer (notes + repo context)
    commands/Mcp.ts       — dot mcp native command handler
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
      Context.ts          — dot git-context entrypoints (text/json/raw over the shared producer)
      Diff.ts             — dot git-diff (--bar-json, --list-changed, --list-all, --raw)
      Log.ts              — dot git-log (--raw)
      Notifications.ts    — dot git-notifications (--bar-json, --list-threads, actions, --raw)
      Workflows.ts        — dot git-workflows (--since, --bar-json, --list-repos, --list-runs, --raw)
    context/              — Shared branch-context producer (git-context + branch-context plugin)
      model.ts            — BranchContextData/Options types and section/char-limit constants
      pullRequest.ts      — gh pr view/checks collection into structured PR data
      build.ts            — buildBranchContext: single git/gh snapshot per options
      renderText.ts       — git-context text renderer
      renderJson.ts       — git-context --json payload renderer (plugin format)
    remotes.ts            — Shared default-remote/branch resolver (git-context + git-commit)
    doctor/
      gitConfig.ts        — managed Git config doctor check
      originHead.ts       — stale local origin/HEAD doctor check (default-branch ref freshness)
    services/
      DotDiff.ts          — Effect service wrapping git diff state
      GitLog.ts           — Recent commit history state for tracked repositories
      GitHub.ts           — Shared GitHub CLI/API wrapper with rate-limit checks and retries
      GitNotifications.ts — GitHub notification inbox state and thread actions
      GitStaging.ts       — Git status/add/reset/commit operations
      RepoWatcher.ts      — Hybrid poll loop (Waybar cache → 10s poll), PubSub state
      relativeTime.ts     — Shared compact relative timestamp formatter
      WorkflowRuns.ts     — Watched GitHub Actions run state for locally checked-out HEAD commits
      workflowStatus.ts   — Shared GitHub Actions status classification helpers
    tui/
      DiffView.ts         — Two-pane layout (Changed/Other) with repo watcher
      GitLogView.ts       — Two-pane recent commit history view
      GitShow.ts          — Suspend/resume git show pager launcher
      GitNotificationsView.ts — GitHub notification inbox with read/done/ignore actions
      WorkflowRunsView.ts — Two-pane watched GitHub workflow runs view
      Lazygit.ts          — Suspend/resume lazygit spawn
      SuspendedCommand.ts — Shared suspend/resume inherited-stdio command helper
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
    initState.ts          — First-use setup state marker helpers
    omarchySync.ts        — First-use Omarchy repo clone/sync helpers
    packageSetup.ts       — Strict package and mise setup helpers for init/install
    selfUpdate.ts         — Binary rebuild logic
    skillCheck.ts         — Skill reference validation logic
    skillUpdates.ts       — Skill update checking/applying logic
    stowFolders.ts        — Stow folder discovery
```

### Data Flow

1. `index.ts` parses CLI flags → resolves mode (TUI / native / fallback)
2. Native commands run with `CliLayers` (no renderer, no TUI)
3. TUI mode composes full layer stack including RepoWatcher, GitLog, WorkflowRuns, GitNotifications, GitStaging, CommitSuggest, Renderer, Toast
4. `App` manages a view stack (main menu ↔ diff view ↔ git log view ↔ workflows view ↔ notifications view ↔ notes view ↔ omarchy menu ↔ staging view ↔ commit view)
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
- `exit-command` — destroy TUI, then run command as a normal CLI process
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

Command and flag metadata lives in `src/cli/spec.ts`. Help rendering,
completion generation, known-command detection, and native command recognition
consume that registry. When changing any command, subcommand, alias, or flag,
update the command spec and run `dot completions` for each supported shell after
rebuilding the binary so stowed shell completion files are regenerated before
stow.

`spec.ts` is also the source for the docs command reference at
`docs/src/content/docs/dot/commands.md`. After changing the spec, regenerate it
with `bun run gen:cli` in `../docs` (alongside shell completions) and commit
the result. The `tui-build` workflow regenerates and commits it on changes to
`dot/`.

```text
dot                           # Main menu (TUI)
dot init                      # One-time first-use setup, ending with dot update; logs to ~/.local/state/dot/init.log
dot init --noninteractive --confirm # Non-interactive first setup for VMs
dot init --host laptop --noninteractive --confirm # First setup with laptop host overrides
dot init --log ~/Public/init.log # First setup with an explicit log path
dot install                   # Ensure prerequisites, then backup/adopt install flow
dot update                    # Full update (install deps, rebuild, restart, pull, trust mise configs, stow, init-state backfill)
dot update --pull             # Pull repos only
dot update --stow             # Stow only
dot update --tui              # Install deps and rebuild binary only
dot update --check            # Report core/system repos behind upstream (no update); exit 10 if any
dot update --check-all        # Report all tracked repos behind upstream (no update); exit 10 if any
dot stow                      # Stow public + private
dot stow --public             # Stow public only
dot stow --private            # Stow private only
dot doctor                    # Health checks
dot doctor --open-opencode    # Health checks + OpenCode analysis
dot clean                     # Unstow private then public
dot git-diff                  # Diff view (TUI)
dot git-diff --tab other      # Diff view, Other tab focused (TUI)
dot diff                      # Short alias for git-diff
dot git-diff --raw            # CLI diff output (no TUI)
dot git-diff --bar-json       # JSON output for status bars and shell modules
dot git-diff --list-changed   # Changed repo rows
dot git-diff --list-all       # All repo rows
dot git-log                   # Recent commits view (TUI)
dot git-log --raw             # CLI recent commit output (20 commits per repo)
dot git-context               # Branch context: branch/PR summary, unstaged, staged, today's commits or last 10 (timestamp, push status, files, line counts)
dot git-context --since "2 days ago" # Branch context with recent commits since a date
dot git-context --comments --reviews # Include PR conversation comments and individual reviews
dot git-context --labels --checks # Include PR labels and CI check runs (extra gh call)
dot git-context --diff        # Branch context plus full unstaged and staged diffs
dot git-context --branch-diff # Branch context plus full merge-base diff vs the default branch (errors on the default branch)
dot git-context --json        # Structured branch-context payload (OpenCode branch-context plugin format)
dot git-commit -m "msg"       # Guarded commit gateway: validates a single-line subject, commits the staged set
dot git-commit -m "msg" --path src/x.ts # Commit only the named file(s) (repeatable), never git add -A
dot git-commit --amend                # Amend the previous commit, keeping its message (folds in staged changes)
dot git-commit --amend -m "msg"       # Amend the previous commit and reword its subject
dot git-commit -m "msg" --push # Commit then push the current branch (pulls --rebase first, sets upstream when missing, never forces)
dot git-commit -m "msg" --dry-run # Preview the commit/push plan without changing anything
dot git-workflows             # Watched GitHub workflow runs view (TUI)
dot git-workflows --raw       # CLI workflow run summary
dot git-workflows --since <date> # Filter workflow runs by creation time (TUI or CLI)
dot git-workflows --bar-json  # JSON output for status bars and shell modules
dot git-workflows --list-repos # Watched repo rows
dot git-workflows --list-runs # Workflow run rows
dot git-notifications         # GitHub notification inbox view (TUI)
dot git-notifications --raw   # CLI notification summary
dot git-notifications --bar-json # JSON output for status bars and shell modules
dot git-notifications --list-threads # Notification thread rows
dot git-notifications --mark-read <id> # Mark a notification read
dot git-notifications --mark-bot-read --dry-run # Preview bot notifications to mark read
dot git-notifications --mark-bot-read # Mark unread bot notifications read
dot git-notifications --mark-done <id> # Mark a notification done
dot git-notifications --ignore <id> # Ignore future notifications for a thread
dot git-notifications --unignore <id> # Stop ignoring a thread
dot notes                     # Repository notes browser (TUI)
dot notes --all               # Repository notes browser across all repos (TUI)
dot notes root             # Print notes vault root (CLI)
dot notes root --repo-notes # Print repository notes directory (CLI)
dot notes context --command notes-list # Print OpenCode notes context (CLI)
dot notes list --all       # List all repo notes with repo section headings (CLI)
dot notes list --format json # List current repo notes as JSON (CLI)
dot handoffs                  # Handoff notes browser (TUI, tag: handoff)
dot handoffs --all            # Handoff notes browser across all repos (TUI)
dot handoffs --list           # List handoff notes to stdout (CLI)
dot handoffs --list --all     # List handoff notes across all repos (CLI)
dot handoff                   # Alias for dot handoffs
dot note read --path <path> # Read a note file
dot note write --path <path> --stdin # Write stdin to a note file and commit it
dot note delete --path <path> # Delete a note file and commit it
dot agents-sync               # Sync AGENTS.md to Cursor rule
dot mcp-sync                  # Regenerate MCP configs for all harnesses from the private spec
dot opencode-debug            # Debug OpenCode config
dot opencode-debug --agent x  # Debug specific agent
dot setup-private-repo        # Register private pacman repo include
dot private-pkg-publish <pkg> --install # Build, publish, and install a mapped private package
dot skill-updates             # Check/apply skill updates
dot skill-updates --check     # Check only (no apply)
dot skill-updates --update    # Auto-apply clean updates
dot skill-updates --skip-review # Skip local-edit review
dot skill-check               # Validate skill references
dot completions zsh           # Generate stowed shell completions
dot omarchy                   # Omarchy submenu (TUI)
dot help                      # Show help
dot --help                    # Show help
```

## Build

```bash
cd ~/.config/dotfiles
mise run dot:build   # outputs to scripts/.local/bin/dot (wraps bun run build)
```

The single root `mise.toml` defines the dev tasks, namespaced `dot:*` (`dot:install`, `dot:build`, `dot:dev`, `dot:typecheck`, `dot:format`, `dot:format:check`, `dot:check`) with `dir = "dot"`; each wraps the matching `bun run` script, so `bun run build` still works for the fresh-machine bootstrap. `dot:build` depends on `dot:install`, so `mise run dot:build` installs dependencies before compiling. CI runs these via `mise run`. Run `mise tasks` to list them.

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

- `~/.cache/waybar/git-diff-waybar.json` — Waybar cache for fast startup
- `NOTES` / `DOT_NOTES_DIR` — notes vault used by `dot notes` and OpenCode note commands
- `~/.config/dotfiles-private/dot-git.yml` — private git repo config for clone/bootstrap, doctor checks, `dot git-diff`, `dot git-log`, `dot git-workflows`, and `dot git-notifications --bar-json`; `activity`, `workflows`, and `notifications` each require explicit `enabled` plus 5-field cron `schedule` keys, and `notifications.bar.ignore_bot_activity` controls status-bar bot noise
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
cd ~/.config/dotfiles
mise run dot:check           # type check + prettier format check
mise run dot:format          # format with prettier (required before every commit)
mise run dot:build           # compile binary
```

The underlying `bunx tsc --noEmit` / `bun run format` / `bun run build` commands remain valid equivalents.

For dead-code analysis, use the MCP `analyze` tool with `root: dot`, or `/fallow-audit`.

### Effect language service

`@effect/language-service` is enabled in `tsconfig.json`, and the `prepare` script patches the local TypeScript (`effect-language-service patch`) so `mise run dot:typecheck` surfaces the official Effect v4 diagnostics inline. Effect errors fail the typecheck; warnings and messages stay advisory (`ignoreEffectWarningsInTscExitCode` is set), so keep them visible but non-blocking. Editors and OpenCode also pick up the plugin's refactors and diagnostics through the TypeScript LSP when the workspace TypeScript version is used. For a report without patching, run `effect-language-service diagnostics --project tsconfig.json` (also `overview`, `quickfixes`, `layerinfo`) from `dot/`, always via the local install rather than a bare remote `bunx`/`npx`.

Dependency note: the tracked lockfile is `pnpm-lock.yaml` (`bun.lock` is gitignored, and CI's `bun install --frozen-lockfile` migrates from `pnpm-lock.yaml`). After changing dependencies with `bun add`, run `pnpm install --lockfile-only` to update the tracked lockfile, otherwise the CI frozen install fails.

Smoke tests:

```bash
dot                          # smoke test: main menu renders, Ctrl+c quits
dot git-diff                 # smoke test: diff view renders
dot git-diff --raw           # smoke test: CLI diff output
dot git-diff --bar-json      # smoke test: JSON output
dot git-log                  # smoke test: git log view renders
dot git-log --raw            # smoke test: CLI git log output
dot git-context              # smoke test: branch context output
dot git-context --diff       # smoke test: branch context with working-tree diffs
dot git-context --branch-diff # smoke test: branch context with default-branch diff (errors on the default branch)
dot git-context --json       # smoke test: structured branch-context JSON payload
dot git-commit --help        # smoke test: gateway help prints without side effects
dot git-commit --dry-run -m "Test subject" # smoke test: dry-run plan, no commit
dot git-commit --amend --dry-run # smoke test: amend plan (keep message), no commit
dot git-notifications --raw  # smoke test: CLI notification output
dot git-notifications --bar-json # smoke test: notification JSON output
dot notes                    # smoke test: notes view renders
dot handoffs                 # smoke test: handoff-filtered notes view renders
dot doctor                   # smoke test: health checks run
dot init --help              # smoke test: init help prints without side effects
dot help                     # smoke test: help prints
```

`dot init` clones the managed Omarchy repos into `~/.config/{waybar,ghostty,uwsm}`. If a stock Omarchy config directory already exists there and is not a git repo, init moves it aside with a `.dot-init-backup-*` suffix before cloning; do not delete those backups automatically. Hyprland config is no longer a tracked repo: it is a stowed dotfiles package (`hypr/.config/hypr/`, conf-only) laid down with `--no-folding`, with the runtime `~/.config/hypr/host` symlink selecting the host overrides.

## Logging Style

Keep logging readable and consistent:

- Section headings in Title Case
- Log labels uppercase (`[INFO]`, `[WARN]`, `[ERROR]`)
- Message text in sentence case

## Shell Helpers

Current shell helpers still used by the TS app or systemd units:

- `dot-doctor-notify` — doctor notification helper
- `git-diff-tmux-session` — tmux session launcher for git diff

## Debugging

Run with stderr visible to see startup logging:

```bash
DOT_DEBUG=1 dot 2>/tmp/dot.log
# or
DOT_DEBUG=1 dot 2>&1 | less
```

Debug log lines are prefixed with `[dot]`.
