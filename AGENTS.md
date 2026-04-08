# DOTFILES AGENTS

Instructions for coding agents working in this repository.

This file is plain Markdown. [Cursor](https://cursor.com/docs/rules) loads `AGENTS.md` from the repo root (and from nested directories when working under those paths). For Cursor-only behavior (globs, `alwaysApply`), use `.cursor/rules/`; that stays separate from this portable file.

**Shared global instructions** (OpenCode and any Cursor project): one on-disk file at `~/.opencode/AGENTS.md`, stowed from `~/.config/dotfiles-private/agents/.opencode/AGENTS.md` when private dotfiles are installed. To reuse the same file in another repo: `ln -sf ~/.opencode/AGENTS.md AGENTS.md` in that project’s root (or use **Cursor → Settings → Rules** for editor-wide text).

## Scope

- This repo is the public dotfiles source at `~/.config/dotfiles`.
- Make changes here (not in `~/.config/*` live paths directly).
- Treat private overlays as optional and separate (`~/.config/dotfiles-private`).

## Key Paths

- Main entrypoint: `scripts/.local/bin/dot`
- Shell wrapper for `dot`: `zsh/.zshrc` (`dot()` function)
- Stow config: `.stowrc`
- Main docs: `README.md`

## Stow Rules

- Repo root is a stow package root targeting `~/`.
- Top-level docs for humans/agents must be ignored by stow.
- Keep `.stowrc` ignore rules in sync when adding root-only files.

## Dot Command Changes

- Keep command orchestration in `scripts/.local/bin/dot`.
- If command behavior depends on parent-shell cwd changes, implement/update logic in `zsh/.zshrc` `dot()`.
- Keep logging readable and consistent:
  - section headings in Title Case
  - log labels uppercase (`[INFO]`, `[WARN]`, `[ERROR]`)
  - message text in sentence case

## Validation

- Syntax check: `bash -n scripts/.local/bin/dot`
- Basic health check: `scripts/.local/bin/dot doctor`
- Diff behavior: `scripts/.local/bin/dot diff`
- Wrapper cwd behavior (interactive zsh):
  - `zsh -ic 'dot diff >/tmp/dot-diff.log 2>&1; pwd'`

## Safety

- Do not run destructive git commands unless explicitly requested.
- Do not commit or push unless explicitly requested.
- Preserve user changes in a dirty working tree; do not revert unrelated edits.

## Response Style

- End task updates with a short finish message: what changed, what was verified, and what remains (if anything).
