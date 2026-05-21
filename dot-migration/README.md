# dot TypeScript Migration — Handoff Index

Phased handoff documents for migrating `dot` from bash to TypeScript + Effect.

## Execution Order

| Phase | File | Focus | Depends On |
|-------|------|-------|-----------|
| 0 | `00-foundation.md` | Rename, core services, CLI dispatch, bash fallback | — |
| 1A | `01a-stow.md` | `dot stow` command | Phase 0 |
| 1B | `01b-update.md` | `dot update` command (pull, stow, rebuild) | Phase 0, 1A |
| 1C | `01c-diff.md` | `dot diff` (all modes: TUI, waybar, list, raw) | Phase 0 |
| 1D | `01d-doctor.md` | `dot doctor` (parallel health checks) | Phase 0, 1A |
| 2 | `02-secondary-commands.md` | help, clean, install, init, agents-sync, etc. | Phase 1 |
| 3 | `03-finalise.md` | Remove bash, update docs, validate | Phase 2 |

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
