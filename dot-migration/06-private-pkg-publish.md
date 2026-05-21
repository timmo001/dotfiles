# Phase 6 — Port `dot private-pkg-publish`

## Focus

Native TypeScript port of `dot private-pkg-publish` — builds a package from a source repo, publishes the artifact to the private pacman repo, syncs the mirror, and optionally commits/pushes + installs.

## Prerequisites

- Phases 0–3 complete
- Phase 5 complete (shared private-repo config parsing can be reused)
- Private dotfiles access available
- Package publish mapping configured (`$DOT_PRIVATE_PACKAGE_MAP_FILE`)

## Current Behaviour (bash)

`cmd_private_pkg_publish` (in `dot-private-pkg-lib`) does:

1. **Parse flags**: `--no-git`, `--skip-build`, `--install`, `<package-name>` (positional)
2. **Resolve source repo**: Load publish map file (key=value: `package-name = ~/repos/source-repo`), find entry for given package name
3. **Build package** (unless `--skip-build`):
   - If `deno.json` exists with `package:arch` task → `deno task package:arch`
   - Else if `Makefile` exists → `make create_arch`
   - Else error
4. **Find artifact**: Glob `dist/${package_name}-*.pkg.tar.zst` (exclude debug packages), take latest
5. **Publish to private repo**:
   - Remove old artifacts for this package from repo path
   - Copy new artifact to repo path
   - Clean lock/old files
   - Run `repo-add` on all non-debug `.pkg.tar.zst` in repo path
6. **Sync mirror**: `rsync` to mirror path (same as setup-private-repo)
7. **Refresh pacman** (if repo registered): `pacman -Sy` (needs root, warns if not)
8. **Install** (if `--install`): `yay -Sy` or `pacman -Sy` or `pkexec pacman -Sy`
9. **Git commit + push** (unless `--no-git`): stage all → commit "publish {name} package" → push

## Config Format

### Publish map file: `$DOT_PRIVATE_PACKAGE_MAP_FILE` (in private dotfiles)
```
go-automate = ~/repos/go-automate
omarchy = ~/repos/omarchy
```

### Repo config: Same as Phase 5 (`$DOT_PRIVATE_PACKAGE_REPO_FILE`)

## Implementation Plan

### File: `dot/src/commands/PrivatePkgPublish.ts`

```
dot private-pkg-publish [flags] <package-name>
  --no-git       Skip commit and push
  --skip-build   Use existing dist artifact
  --install      Install the published package after publishing
  --help         Show usage
```

### Approach

- Use `Effect.gen` with `CommandExecutor` + `Config` services
- Reuse private repo config parsing from Phase 5 (extract to shared `lib/privatePackageConfig.ts`)
- Build step: detect build system (deno.json → Makefile → error), spawn subprocess
- Artifact discovery: glob `dist/` directory for matching `.pkg.tar.zst` files
- Publish: file operations (remove old, copy new, repo-add)
- Mirror sync: reuse from Phase 5
- Git operations: `git -C <path> add . && diff --cached --quiet && commit && push`
- Install: prefer `yay` → `pkexec pacman` fallback chain

### Shared Code to Extract

Extract from Phase 5 into `dot/src/lib/privatePackageRepo.ts`:
- `loadPrivatePackageRepoConfig()`
- `syncPrivatePackageRepoMirror()`
- `privatePackageRepoRegistered()`

### Dependencies

- `CommandExecutor` service (existing)
- `Config` service (existing)
- `deno` or `make` (external, for build)
- `repo-add` (external, pacman repo tooling)
- `rsync` (external)
- `git` (external)
- `yay` / `pacman` / `pkexec` (external, for install)

## Validation

```bash
bunx tsc --noEmit
bun run build
dot private-pkg-publish --help   # smoke test: usage prints
```

## Register in index.ts

Add `"private-pkg-publish"` to `nativeCommands` set and add case in the native command switch.

## Skills

- `effect`
- `types-enforce-ts`
- `pkexec-root` (for install step)
