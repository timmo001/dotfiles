# dot TypeScript Migration — Handoff Index

Phased handoff documents for migrating `dot` from bash to TypeScript + Effect.

## Execution Order

| Phase | File | Focus | Depends On | Status |
|-------|------|-------|-----------|--------|
| 0 | `00-foundation.md` | Rename, core services, CLI dispatch, bash fallback | — | Done |
| 1A | `01a-stow.md` | `dot stow` command | Phase 0 | Done |
| 1B | `01b-update.md` | `dot update` command (pull, stow, rebuild) | Phase 0, 1A | Done |
| 1C | `01c-diff.md` | `dot diff` (all modes: TUI, waybar, list, raw) | Phase 0 | Done |
| 1D | `01d-doctor.md` | `dot doctor` (parallel health checks) | Phase 0, 1A | Done |
| 2A | `02a-secondary-commands.md` | help, clean, install, setup, agents-sync, opencode-debug | Phase 1 | Done |
| 2B | `02b-skill-updates.md` | `dot skill-updates` | Phase 1 | Done |
| 3 | `03-finalise.md` | Update docs/config, validate | Phase 2 | Done |
| 4 | `04-init.md` | `dot init` (interactive init questionnaire + bootstrap) | Phase 3 | Pending |
| 5 | `05-setup-private-repo.md` | `dot setup-private-repo` (private pacman repo config) | Phase 3 | Pending |
| 6 | `06-private-pkg-publish.md` | `dot private-pkg-publish` (build + publish + install) | Phase 5 | Pending |
| 99 | `99-remove-legacy.md` | Remove legacy bash scripts and BashFallback service | Phase 4–6 | Deferred |

## How to Use

Each document is self-contained — open one per agent session. They include:
- Exact scope and focus
- Prerequisites (what must exist before starting)
- Implementation guidance with code patterns
- Key files to read (minimises exploration time)
- Validation steps
- Suggested skills to load

## Key Decisions (do not re-ask)

- **Gradual migration** — bash fallback for unported commands
- **Full Effect** — no plain objects, no module singletons, no workarounds
- **Auto-detect mode** — TUI if interactive TTY, plain stdout if piped
- **External tools** stay as subprocess calls (omarchy, stow, git, pacman, etc.)
- **Self-update** — atomic rename + re-exec
- **No zsh wrapper** — binary called directly
- **No env vars** — flags and application config only
- **Doctor = integration test**
