# Phase 4 — Port `dot init`

## Focus

Native TypeScript port of `dot init` — the interactive initialisation workflow that bootstraps a fresh machine or re-initialises an existing one.

## Prerequisites

- Phases 0–3 complete (all core commands ported, TUI working)
- `gum` available for interactive prompts (or graceful fallback)
- Understanding of omarchy repo structure and branch discovery

## Current Behaviour (bash)

`cmd_init` orchestrates these steps:

1. **Parse flags**: `--confirm`, `--noninteractive`, `--interactive`, `--branch <name>`, `--bootstrap-branch <name>`
2. **Run questionnaire** (interactive only, requires `gum` + `gh`):
   - Discover and select omarchy branch
   - Confirm bootstrap init
   - Detect missing public Arch packages → confirm install
   - Detect missing private Arch packages → confirm install
3. **Sync omarchy repos** (`omarchy_sync_repos` with branch args)
4. **Run bootstrap init** (if confirmed — executes `$OMARCHY_REPO_BASE/bootstrap/init.sh`)
5. **Run setup packages** (pacman/yay installs via `cmd_setup`)
6. **Install public packages** (AUR/pacman from dotfiles package list)
7. **Install private packages** (from private package list, if private access available)
8. **Install public dotfiles** (`dot stow` public)
9. **Configure workflow watch** (git hooksPath + systemd timer)
10. **Configure git config include** (add `~/.config/git/config.dotfiles` include)
11. **Install private dotfiles** (`dot stow` private, if available)

## Implementation Plan

### File: `dot/src/commands/Init.ts`

```
dot init [flags]
  --confirm           Auto-confirm package installs
  --noninteractive    Skip all prompts
  --interactive       Force prompts even if not TTY
  --branch <name>     Override omarchy branch
  --bootstrap-branch <name>  Override bootstrap branch for sync
```

### Approach

- Use `Effect.gen` with `CommandExecutor` service for subprocess calls
- Interactive prompts: shell out to `gum choose` / `gum confirm` (same as bash — avoid reimplementing TUI prompts for a rarely-run command)
- Package detection: parse package list files, check against `pacman -Qq` output
- Each step is an Effect that logs section headers and results
- Steps that depend on private access use `Config.canUsePrivate` guard
- Reuse existing `Stow` command for the stow steps

### Key Helpers to Extract/Reuse

- `discoverOmarchyBranches()` — calls `gh api` to list remote branches
- `collectMissingPackages(listFile)` — diff package list against installed
- `configureWorkflowWatch()` — set git hooksPath + enable systemd timer
- `configureGitConfigInclude()` — add include.path to git config

### Dependencies

- `CommandExecutor` service (existing)
- `Config` service (existing — paths, private access detection)
- `gum` binary (external, optional)
- `gh` binary (external, optional for branch discovery)
- `pacman`/`yay` (external)
- `systemctl` (external)

## Validation

```bash
bunx tsc --noEmit
bun run build
dot init --noninteractive    # smoke test: runs full flow without prompts
dot init --help              # (add --help support)
```

## Register in index.ts

Add `"init"` to `nativeCommands` set and add case in the native command switch.

## Skills

- `effect`
- `opentui` (not needed — no TUI, CLI only)
- `types-enforce-ts`
