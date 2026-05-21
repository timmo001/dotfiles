# Handoff: Phase 3B — Remove Legacy Bash Scripts

## Focus

Remove all legacy bash scripts once confident nothing depends on them.

---

## Prerequisites

- Phase 3 complete (docs updated, validation passing)
- No remaining calls to `dot-legacy` from the TS binary or external consumers
- Verified that cron jobs, waybar timers, and external scripts all use the new `dot` binary directly

---

## Steps

### 3B.1 Audit remaining callers

Search for any references to `dot-legacy` or the bash helper scripts:

```bash
rg -l 'dot-legacy|dot-lib|dot-cron-lib|dot-doctor-lib|dot-doctor-notify|dot-diff-tmux-session|dot-omarchy-lib|dot-private-pkg-lib|dot-skill-updates-lib' ~/.config/dotfiles/ ~/.config/dotfiles-private/ 2>/dev/null
```

### 3B.2 Remove bash scripts

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

### 3B.3 Remove BashFallback service

In `dot/src/`:
- Delete `services/BashFallback.ts` (or gut it to a no-op that errors)
- Remove fallback dispatch path from `index.ts`
- Remove from service layer composition

### 3B.4 Update `.stowrc`

Remove any ignores that were only needed for the bash helpers.

### 3B.5 Run `dot stow` and validate

```bash
dot stow
dot doctor
```

Confirm no dangling symlinks remain for deleted scripts.

### 3B.6 Git cleanup

- Single commit removing all bash remnants
- Optional tag: `git tag v1.0.0-ts-no-legacy`

---

## Constraints

- Do not delete external tools or their configs (omarchy, waybar, etc.)
- Verify no cron/timer/external script still calls any of the removed scripts before deleting
