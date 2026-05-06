# Dotfiles

My public Arch/Omarchy dotfiles, managed with GNU Stow and the `dot` command.

## At a glance

- Stow-based dotfiles rooted at `~/.config/dotfiles`
- Public config for shell, editor, and tooling
- One command entrypoint at `scripts/.local/bin/dot`
- Optional private overlays from `~/.config/dotfiles-private`
- Omarchy repo sync for `bootstrap`, `hypr`, `waybar`, `ghostty`, and `uwsm`
- Global git workflow watch for watched GitHub repos on this machine

## Repository layout

- `scripts/.local/bin/dot` - main command entrypoint
- `.stowrc` - stow target and ignore rules
- `zsh/` - shell config
- `neovim/` - Neovim config
- `starship/` - prompt config
- `agents/` - agent tooling: public OpenCode (`.opencode/`), Cursor launcher script (`.local/bin/cursor`); private overlay adds `~/.cursor/` (`argv.json`, `mcp.json`, rules), Claude Code, OpenCode secrets, `~/.config/opencode/` (see `dot agents-sync`)
- `editorconfig/` - editor config

## Split worktrees

- Current desktop/laptop split worktree repo: `hypr`
- Laptop worktree: `~/.config/hypr` on branch `laptop`
- Desktop worktree: `~/.config/hypr-desktop` on branch `desktop`
- If this split-worktree setup changes, update the relevant `README.md`, `AGENTS.md`, and skill documentation together so the documented layout stays accurate

## Quick start

```bash
# Before dot is on PATH
~/.config/dotfiles/scripts/.local/bin/dot help

# Typical workflow
dot init
dot update
dot diff
dot doctor
```

## Command reference

- `dot init` - questionnaire (when available), Omarchy sync (including split-repo worktree setup like `hypr-desktop`), package setup, optional public/private Arch package install, then public/private install and workflow-watch setup
- `dot update` - Omarchy + public/private pull (including optional extra private repos and split Omarchy repo worktrees), then stow refresh and workflow-watch reconfiguration
- `dot stow` - stow refresh only (no git pull)
- `dot diff` - git status + staged/unstaged summaries with fetched unpushed/incoming commit checks across managed repos (including optional extra private repos and split Omarchy repo worktrees); use `dot diff --waybar` for one-line Waybar JSON
- `dot setup [--confirm]` - package install step only
- `dot install` - backup/adopt install flow for public/private dotfiles
- `dot clean` - unstow private then public
- `dot doctor` - tool, repo, workflow watch, extra repo, remote, public/private package, private package repo, and Chromium extension health checks
- `dot opencode-debug [--agent <name>]` - run `opencode debug paths`, `config`, `skill`, and `info` together; optionally inspect one agent with `opencode debug agent <name>`
- `dot private-pkg-publish [--no-git] [--skip-build] [--install] <package>` - build and publish a mapped private package into the private pacman repo, sync the mirror, refresh pacman metadata, optionally install it, and commit/push by default
- `dot agents-sync` - copy `~/.config/opencode/AGENTS.md` into `agents/.cursor/rules/global-agents.mdc` in private dotfiles by default (`alwaysApply: true` + body; stows to `~/.cursor/rules/`). **`dot update`** and **`dot diff`** run this automatically by default (see env vars below).

## OpenCode workflow features

- `/git-workflow` - read precomputed branch, diff, and PR context from `BranchContextPlugin`; prefer this over repeated ad-hoc `git`/`gh` inspection when you want the current work scope
- `/plan [focus]` - manual entrypoint for native OpenCode plan mode; produce a plan from the existing conversation and gathered context instead of starting planning from scratch
- `/review-current-work` - run a current-branch review through the shared `code-reviewer` agent using `BranchContextPlugin` context instead of rebuilding branch state by hand
- `/refactor-current-work [scope]` - run a behaviour-preserving refactor through the shared `code-refactorer` agent using `BranchContextPlugin` context for the current branch scope
- `/investigate <topic>` - use the shared `ask` agent for general investigation, triage, and context gathering without editing by default
- `diagnose` - feedback-loop-first debugging skill for hard bugs, regressions, flaky behaviour, and performance problems
- `improve-codebase-architecture` - architecture-review skill for spotting structural friction and proposing focused improvements in a specific area
- `write-a-skill` - local skill-authoring guidance for concise descriptions, minimal supporting files, and reusable OpenCode workflows
- `/explore-codebase <topic>` - delegate broad codebase discovery to the `task` `explore` subagent instead of doing long serial searches in one agent
- `/improve-codebase-architecture <area>` - review a named feature, subsystem, or file family for architectural friction and focused structural improvements without editing first
- `/debug-frontend <page or issue>` - start browser-specific debugging with Chrome DevTools evidence first: snapshot, console, network, then Lighthouse or performance traces when the issue calls for them
- `/fallow-audit [workspace]` - audit changed JavaScript or TypeScript code with Fallow for dead code, complexity, and duplication before deciding on cleanup or follow-up fixes
- `/fallow-project-analyse [workspace]` - run a broader Fallow project analysis for JavaScript or TypeScript using full dead-code, health, duplication, and other deeper project-level modes when useful
- `dot opencode-debug [--agent <name>]` - validate resolved OpenCode paths, config, skills, and agent config after changing commands, skills, plugins, or agent docs
- `/memorise` - save one rewritten durable preference, rule, decision, or correction through the memory plugin instead of editing `AGENTS.md` by hand; avoid using it for temporary task notes
- First-class agents - use `ask` via `/git-workflow` or `/investigate`, `code-reviewer` via `/review-current-work`, and `code-refactorer` via the shared cleanup/type commands when you want a task routed through a narrower operating mode instead of one large general prompt
- Native plan handoff - execution-oriented agents such as `build-ask`, `ask`, `code-refactorer`, and `build-locked` can call native `plan_enter` themselves when work becomes broad, sequencing-heavy, or materially ambiguous; `/plan` remains the explicit manual way to start in planning mode
- Subagents - use `/explore-codebase` for broad codebase discovery and `task` delegation for other parallelizable multi-step work
- Chrome DevTools MCP - use `/debug-frontend` or direct DevTools tools for snapshots, console/network inspection, Lighthouse, and performance traces instead of guessing from source alone
- Fallow MCP - use `/fallow-audit` or direct Fallow tools when you need dead-code, complexity, duplication, or cleanup evidence for JS/TS changes
- Fallow deeper project analysis - use `/fallow-project-analyse` when you want broader project-level inspection instead of changed-code audit scope

## System health check

- `system-health-check` - friendly multi-snapshot system health report for CPU, memory, network, pressure, and known logs
- Add `--open-opencode` to run `opencode run` against the saved report, then open a full interactive OpenCode session with `opencode --continue`

## Workflow watch

- Public dotfiles provide the global `pre-push` hook, poller, and user systemd units
- Private dotfiles provide the watchlist in `~/.config/dotfiles-private/.git-workflow-watch-repos`
- The global hook queues pushed commits only for watched GitHub repositories and only when the commit matches the local git identity
- The watcher polls `gh run list --commit <sha>` and sends one desktop notification per workflow run as each run completes
- Failed workflow runs are cached for Waybar; left click opens all tracked failed run URLs, right click clears the list, and stale failures expire automatically after 1 hour by default
- `dot init`, `dot install`, and `dot update` configure the global `core.hooksPath` and enable `git-workflow-watch.timer`; `dot stow` only links files
- `dot doctor` verifies the hooks path, watchlist file, timer state, and active Waybar workflow-failures module wiring

## Daily volume reset

- Public dotfiles provide `daily-volume-zero.timer` in laptop-only stow packages (`scripts--laptop` and `systemd--laptop`), a user systemd timer that runs at 5am local time
- The timer runs `daily-volume-zero`, which sends a 10-second desktop notification, clears default sink mute, then sets the default PipeWire/WirePlumber sink volume to `0%`
- The timer is optional and is not enabled by `dot`; use `systemctl --user enable --now daily-volume-zero.timer` on machines that should use it

## Environment options

- `DOTFILES_PUBLIC_DIR` - public dotfiles path (default `~/.config/dotfiles`)
- `DOTFILES_PRIVATE_DIR` - private dotfiles path (default `~/.config/dotfiles-private`)
- `DOT_ALLOW_PRIVATE` - `auto|always|never` (default `auto`)
- `DOT_PRIVATE_GH_USER` - expected GitHub user for private actions (default `timmo001`)
- `DOT_PRIVATE_EXTRA_REPOS_FILE` - extra private repo config file for `dot diff`/`dot update`/`dot doctor` (default `$DOTFILES_PRIVATE_DIR/.dot-extra-repos`, format: `name|path[|schedule]` or just `path`; 5-field cron schedules such as `* 8-15 * * 1-5` filter diff/Waybar visibility only; `dot doctor` expects each repo to be on a named branch with an upstream)
- `DOT_PRIVATE_PACKAGE_REPO_FILE` - private pacman repo config for `dot` (default `$DOTFILES_PRIVATE_DIR/.dot-private-package-repo`)
- `DOT_PRIVATE_PACKAGES_FILE` - private package list for `dot` (default `$DOTFILES_PRIVATE_DIR/.dot-private-packages`)
- `DOT_PRIVATE_PACMAN_REPO_CONFIG` - pacman repo snippet path written by `dot` (default `/etc/pacman.d/timmo-private.conf`)
- `OMARCHY_REPO_BASE_DIR` - Omarchy repo base path (default `~/.config`)
- `DOT_OMARCHY_BRANCH` - branch override for split Omarchy repos (currently `hypr`)
- `DOT_BOOTSTRAP_BRANCH` - branch for `bootstrap` sync (default `distro/omarchy`)
- `DOT_INCLUDE_OMARCHY_DIFF_REPOS` - include Omarchy repos in `dot diff` (`1|0`, default `1`)
- `DOT_INCLUDE_OMARCHY_UPDATE_REPOS` - include Omarchy repos in `dot update` sync (`1|0`, default `1`)
- `DOT_INIT_NONINTERACTIVE` - skip init questionnaire (`1|0`, default `0`)
- `DOT_WORKFLOW_WATCH_HOOKS_PATH` - global git hooks path for workflow watch (default `~/.config/git/workflow-watch-hooks`)
- `DOT_WORKFLOW_WATCH_REPOS_FILE` - watched repo list file (default `$DOTFILES_PRIVATE_DIR/.git-workflow-watch-repos`)
- `DOT_WORKFLOW_WATCH_TIMER_UNIT` - workflow polling timer unit name (default `git-workflow-watch.timer`)
- `DOT_DAILY_VOLUME_ZERO_TIMER_UNIT` - 5am volume reset timer unit name (default `daily-volume-zero.timer`)
- `DOT_AUTO_CD` - zsh wrapper auto-cd to first repo with changes after `dot diff`; otherwise restore original dir (failed diff falls back to `~/.config/dotfiles`) (`1|0`, default `1`)
- `DOT_AGENTS_SYNC_SOURCE` - AGENTS file to mirror (default `~/.config/opencode/AGENTS.md`)
- `DOT_AGENTS_SYNC_RULE_FILE` - Cursor rule output path (default `$DOTFILES_PRIVATE_DIR/agents/.cursor/rules/global-agents.mdc`, else `~/.cursor/rules/global-agents.mdc`)
- `DOT_AGENTS_SYNC_ON_UPDATE` - run `agents-sync` after `dot update` (`1|0`, default `1`)
- `DOT_AGENTS_SYNC_ON_DIFF` - run `agents-sync` after `dot diff` (`1|0`, default `1`)

## New machine checklist

1. Clone `dotfiles` to `~/.config/dotfiles`
1. Clone `dotfiles-private` to `~/.config/dotfiles-private` (if available)
1. Confirm `gh auth status` works
1. Run `~/.config/dotfiles/scripts/.local/bin/dot doctor`
1. Run `~/.config/dotfiles/scripts/.local/bin/dot init`
1. Restart shell and confirm `dot help` is on `PATH`
1. Run `dot diff` and verify expected repo state
1. Run `dot update` to validate sync + stow end-to-end
