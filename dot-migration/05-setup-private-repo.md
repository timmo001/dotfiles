# Phase 5 — Port `dot setup-private-repo`

## Focus

Native TypeScript port of `dot setup-private-repo` — configures the private pacman repository (mirror sync, pacman config write, include registration).

## Prerequisites

- Phases 0–3 complete
- Private dotfiles access available (`Config.canUsePrivate`)
- Understanding of private package repo config format

## Current Behaviour (bash)

`cmd_setup_private_repo` (in `dot-private-pkg-lib`) does:

1. **Guard**: Verify private access is available
2. **Guard**: Load private package repo config from `$DOT_PRIVATE_PACKAGE_REPO_FILE` (key=value format: `name`, `path`, `mirror_path`, `siglevel`)
3. **Sync mirror**: `rsync -a --delete --exclude .git/` from repo clone → mirror path
4. **Write pacman config** (if not registered or config doesn't match): Write `[repo-name]` + `SigLevel` + `Server = file://mirror_path` to `/etc/pacman.d/` config file (requires sudo/pkexec)
5. **Register include** (if not in `pacman.conf`): Append `Include = /etc/pacman.d/...` to main pacman config (requires sudo/pkexec)
6. **Report status**: Success or incomplete warning

## Config Format

File: `$DOT_PRIVATE_PACKAGE_REPO_FILE` (in private dotfiles)
```
name = timmo-private
path = ~/repos/private-packages
mirror_path = ~/repos/private-packages-mirror
siglevel = Optional TrustAll
```

## Key Paths (from dot-legacy vars)

- `DOT_PRIVATE_PACKAGE_REPO_FILE` — config file with repo settings
- `DOT_PRIVATE_PACMAN_REPO_CONFIG` — output path for pacman repo config (e.g. `/etc/pacman.d/timmo-private`)
- `DOT_PRIVATE_PACMAN_MAIN_CONFIG` — `/etc/pacman.conf`

## Implementation Plan

### File: `dot/src/commands/SetupPrivateRepo.ts`

```
dot setup-private-repo
```

No flags — simple idempotent setup.

### Approach

- Use `Effect.gen` with `CommandExecutor` + `Config` services
- Config parsing: read file, parse key=value (skip comments/blank lines)
- Mirror sync: `rsync` subprocess
- Pacman config: check → write via `pkexec tee` (not plain sudo — per skill guidance)
- Include registration: grep check → append via `pkexec tee -a`
- All steps idempotent — skip if already correct

### Dependencies

- `CommandExecutor` service (existing)
- `Config` service (existing — private paths, canUsePrivate)
- `rsync` (external)
- `pkexec` (external, for `/etc` writes)
- `grep` (external, for include check)

## Validation

```bash
bunx tsc --noEmit
bun run build
dot setup-private-repo       # smoke test: reports configured or incomplete
```

## Register in index.ts

Add `"setup-private-repo"` to `nativeCommands` set and add case in the native command switch.

## Skills

- `effect`
- `types-enforce-ts`
- `pkexec-root` (for `/etc` writes)
