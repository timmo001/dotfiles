# Handoff: Phase 3 — Finalise

## Focus

Remove all bash remnants, clean up stow/git configuration, update documentation, and validate the complete migration via `dot doctor`.

---

## Prerequisites

- Phase 0, 1, and 2 complete
- All commands either ported to TS or deliberately kept as external subprocess calls
- No remaining calls to `dot-legacy` (bash fallback no longer needed)

---

## Steps

### 3.1 Remove bash scripts

Delete from `scripts/.local/bin/`:
- `dot-legacy` (the renamed original)
- `dot-lib`
- `dot-cron-lib`
- `dot-doctor-lib`
- `dot-doctor-notify`
- `dot-diff-tmux-session`
- `dot-omarchy-lib`
- `dot-private-pkg-lib`
- `dot-skill-updates-lib`

These are all internal bash helpers. External tools (`omarchy`, `stow`, `git`, etc.) are unchanged.

### 3.2 Remove zsh wrapper remnants

Verify `zsh/.zshrc` no longer contains a `dot()` function. If any references to `dot-tui` remain, update them to just `dot`.

### 3.3 Update `.stowrc`

Ensure ignore rules are correct:
- `--ignore=^/dot` (source directory, not stowed)
- Remove any `--ignore=^/tui` if still present
- Remove ignores for deleted bash helper scripts if they were listed

### 3.4 Update `dot/package.json`

- Confirm name is `dot-cli`
- Confirm build output is `../scripts/.local/bin/dot`
- Remove any references to `dot-tui` in scripts

### 3.5 Update `dot/AGENTS.md`

Rewrite to reflect the new architecture:
- Binary is `dot` (not `dot-tui`)
- Full Effect service architecture
- New module structure (commands/, doctor/, services/, tui/, lib/)
- Updated validation commands
- Updated CLI reference

### 3.6 Update root `AGENTS.md`

- Update "Key Paths" table (remove bash script references, add `dot/` directory)
- Update "Validation" section
- Remove references to `dot-tui` (it's now just `dot`)
- Update stow workflow notes

### 3.7 Update `README.md`

- Update installation instructions
- Update architecture section
- Remove bash script documentation
- Add new command reference

### 3.8 Clean up menu registry

In `dot/src/menu.ts`:
- Remove any `bash -c "dot-legacy ..."` command references
- All menu items should reference the new Effect commands directly
- Menu actions that previously called `dot <subcommand>` should instead dispatch to the command Effect directly (no subprocess self-call)

### 3.9 Final validation

Run the full integration test:

```bash
cd ~/.config/dotfiles/dot && bun run build
dot doctor            # All checks pass = system healthy
dot                   # TUI opens
dot update            # Full update cycle works
dot stow             # Stow works
dot diff --waybar    # Machine output works
dot diff             # TUI diff view works
dot help             # Help prints
```

### 3.10 Git cleanup

- Single commit or squash-merge the final removal of bash scripts
- Tag the release (optional): `git tag v1.0.0-ts`

---

## Things to Verify Before Declaring Done

- [ ] `dot` binary works from any directory (not just dotfiles root)
- [ ] Machine-output modes (`--waybar`, `--list-changed`, `--list-all`) produce identical output to the old bash version
- [ ] Waybar integration still works (cron/timer calls `dot diff --waybar`)
- [ ] `dot doctor` catches real problems (break something, verify it reports it)
- [ ] TUI views all work: main menu, diff, omarchy, staging, commit
- [ ] Suspend/resume works: lazygit, opencode launch correctly from TUI
- [ ] Private dotfiles handling: works when available, skips gracefully when not
- [ ] Self-update: `dot update` rebuilds and relaunches correctly
- [ ] Log file written to `~/.local/state/dot/logs/`
- [ ] No references to `dot-tui` remain in stowed paths or configs

---

## Key Files to Read

| Path | Why |
|------|-----|
| `dot/src/index.ts` | Verify no bash fallback calls remain |
| `dot/src/menu.ts` | Verify menu actions are all native |
| `.stowrc` | Verify ignore rules |
| `zsh/.zshrc` | Verify no dot() wrapper |
| `AGENTS.md` | Needs updating |
| `README.md` | Needs updating |

---

## Suggested Skills

- `dotfiles-stow` — Stow cleanup and validation
- `effect` — Final service wiring verification

---

## Constraints

- Do not delete external tools or their configs (omarchy, waybar, etc.)
- Verify backwards compatibility of machine-output formats (waybar depends on exact JSON shape)
- Run `dot doctor` as final gate — 0 errors means migration is complete
