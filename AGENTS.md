# DOTFILES AGENTS

Instructions for coding agents working in this repository.

This file is plain Markdown. [Cursor](https://cursor.com/docs/rules) loads `AGENTS.md` from the repo root (and from nested directories when working under those paths). For Cursor-only behavior (globs, `alwaysApply`), use `.cursor/rules/`; that stays separate from this portable file.

**Shared global instructions** (OpenCode and any Cursor project): one on-disk file at `~/.opencode/AGENTS.md`, stowed from `~/.config/dotfiles-private/agents/.opencode/AGENTS.md` when private dotfiles are installed. **`dot agents-sync`** writes the mirrored Cursor rule to **`dotfiles-private/agents/.cursor/rules/global-agents.mdc`** by default (stows to `~/.cursor/rules/`) with **`alwaysApply: true`**; **`dot update`** and **`dot diff`** run the sync by default (`DOT_AGENTS_SYNC_ON_*`). Claude Code config is in the same private **`agents/`** tree (`.claude/`, `.claude.json`). To reuse AGENTS in another repo: `ln -sf ~/.opencode/AGENTS.md AGENTS.md` in that project’s root (or **Cursor → Settings → Rules**).

## Scope

- This repo is the public dotfiles source at `~/.config/dotfiles`.
- Make changes here (not in `~/.config/*` live paths directly).
- Treat private overlays as optional and separate (`~/.config/dotfiles-private`).
- Keep personal machine checks, browser extension checks, private package manifests, and other user-specific data in `~/.config/dotfiles-private`; the public repo should only contain the reusable logic that reads those private configs.

## Private Repositories

- Before adding repo-specific logic, paths, or checks to this public repo, determine whether the target repository is public or private.
- For repository visibility, check the git remote and hosting visibility instead of assuming from the folder name or local path.
- Keep private repository lists, private package manifests, browser checks, and other machine-specific repo metadata in `~/.config/dotfiles-private`.
- In this public repo, keep only the shared logic that reads optional private repo config such as `.dot-extra-repos`, `.dot-browser-checks`, or future private package config files.

## Key Paths

- Main entrypoint: `scripts/.local/bin/dot`
- Shell wrapper for `dot`: `zsh/.zshrc` (`dot()` function)
- Stow config: `.stowrc`
- Main docs: `README.md`

## Go Automate Home Assistant Bridge Policy

- For Home Assistant entity watchers used by Waybar/scripts, use `go-automate ha bridge watch entity` by default.
- Treat `go-automate ha watch entity` direct-style usage as a fallback only when bridge mode is unavailable.
- Prefer `--waybar` output for machine-consumed flows; plain text output should be treated as human-facing unless explicitly needed.

## Skill Application

- For every code change, apply all matching OpenCode skills before editing.
- If a user asks for a local "rule" in OpenCode context, treat that as a request for the corresponding skill and use "skill" in new docs/config.
- If a change spans multiple scopes, apply all relevant skills together (not just one).

## TypeScript Skills

- For any TypeScript edit or TypeScript-focused review (`.ts`, `.tsx`, `.mts`, `.cts`), apply the `types-enforce-ts` skill before making changes.

## Code Skills

- Apply `cleanup-unnecessary-variables` as a general code-quality skill for all code changes when its guidance is relevant, not only explicit cleanup requests.
- Apply `remove-single-use-functions` as a general code-quality skill for all code changes when its guidance is relevant, not only explicit cleanup requests.
- For TypeScript changes where these skills apply, apply `types-enforce-ts` alongside them when scopes overlap.

## Split Worktrees

- The current desktop/laptop split worktree repo is `hypr`.
- Laptop worktree: `~/.config/hypr` on branch `laptop`.
- Desktop worktree: `~/.config/hypr-desktop` on branch `desktop`.
- If this worktree layout changes, update all relevant `README.md`, `AGENTS.md`, and skill documentation together so repo instructions stay consistent.

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

## Script Configuration Policy

- For dotfiles and system scripts, prefer explicit CLI flags over environment-variable toggles for runtime behavior.
- Use environment variables only for standard process context (`HOME`, `PATH`, `XDG_*`, etc.), secrets, or compatibility shims that already exist.
- For test/simulation/force behaviors, implement documented flags first; if an env fallback is temporarily needed, treat it as deprecated and remove it in follow-up cleanup.

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
