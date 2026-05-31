# DOTFILES AGENTS

Instructions for coding agents working in this repository.

This file is plain Markdown. [Cursor](https://cursor.com/docs/rules) loads `AGENTS.md` from the repo root (and from nested directories when working under those paths). For Cursor-only behavior (globs, `alwaysApply`), use `.cursor/rules/`; that stays separate from this portable file.

**Shared global instructions** (OpenCode and any Cursor project): one on-disk file at `~/.config/opencode/AGENTS.md`, stowed from `~/.config/dotfiles-private/agents/.config/opencode/AGENTS.md` when private dotfiles are installed. **`dot agents-sync`** writes the mirrored Cursor rule to **`dotfiles-private/agents/.cursor/rules/global-agents.mdc`** by default (stows to `~/.cursor/rules/`) with **`alwaysApply: true`**; **`dot update`** and **`dot git-diff`** run the sync by default (`DOT_AGENTS_SYNC_ON_*`). Claude Code config is in the same private **`agents/`** tree (`.claude/`, `.claude.json`). To reuse AGENTS in another repo: `ln -sf ~/.config/opencode/AGENTS.md AGENTS.md` in that project’s root (or **Cursor → Settings → Rules**).

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

- Main entrypoint: `scripts/.local/bin/dot` (compiled binary from `dot/src/`)
- Source: `dot/` (Bun + Effect v4 + OpenTUI; excluded from stow)
- Stow config: `.stowrc`
- Main docs: `README.md`
- OpenCode config source: `agents/.config/opencode/`
- Skills source: `agents/.agents/skills/` (stows to `~/.agents/skills/`; shared by OpenCode + Codex)
- Published OpenCode config: [`timmo001/opencode-config`](https://github.com/timmo001/opencode-config)

## OpenCode Workflow

- Prefer `/inject-context` and `/review-current-work` for current-branch context instead of rebuilding that snapshot with repeated `git status`, `git diff`, `git log`, or `gh pr` calls. `/inject-context` accepts an optional inline instruction (e.g. `/inject-context add x to the y`); without one it injects context and waits.
- Use `/refactor-current-work` for behaviour-preserving cleanup within the current branch scope instead of rebuilding that scope manually before a refactor.
- Use `/plan` as the manual entrypoint to native planning mode when explicit implementation planning would help; reuse the existing conversation context instead of rebuilding it from scratch.
- Some execution-oriented agents can now call native `plan_enter` themselves for broad, multi-step, sequencing-heavy, or materially ambiguous work; prefer that automatic handoff when the agent is already in execution flow.
- `/inject-context`, `/review-current-work`, and the scoped cleanup/type commands use `BranchContextPlugin`; treat its injected `<work-scope>` section as the canonical scope source unless the user explicitly asks for a refresh.
- For human-written command names and command/docs prose in this repo, prefer UK spelling. Keep upstream tool, API, or MCP names unchanged when they use US spelling.
- Use first-class agents intentionally: `ask` for clarification/light investigation, `reviewer` via `/review-current-work` for reviews, and `refactorer` for behavior-preserving cleanup.
- Use `/investigate` as the default shared `ask` entrypoint for general investigation, triage, and context gathering when the work is not specifically codebase exploration, frontend debugging, or Fallow analysis.
- Use the `diagnose` skill for hard bug reports, regressions, flaky behaviour, and performance diagnosis when the work needs a reproducible feedback loop before fixing.
- Use the `improve-codebase-architecture` skill for architecture reviews, maintainability analysis, and structural follow-up when an area feels scattered, tightly coupled, or hard to reason about.
- Use `/explore-codebase` for broad discovery questions and use subagents for other parallelizable multi-step work instead of doing long serial searches in one agent.
- Use `/improve-codebase-architecture <area>` when you want a focused architecture review of a named feature, subsystem, or file family without editing first.
- Use `/debug-frontend` for browser-specific investigation before falling back to source-only reasoning.
- Use `/fallow-audit` when JS/TS changes need dead-code, complexity, or duplication evidence before cleanup or review follow-up.
- Use `/fallow-project-analyse` when you want broader Fallow project analysis beyond changed-code audit scope.
- For frontend debugging, prefer Chrome DevTools tools (snapshot, console, network, Lighthouse, performance trace) over static reasoning alone when the issue is browser-behavior-dependent.

## Documentation and External Lookups

- For library or framework documentation, prefer `context7` tools over `webfetch` or `gh` CLI.
- For GitHub-hosted documentation, code patterns, or real-world usage examples, prefer `gh_grep` over `webfetch`, `gh api`, or `gh repo view` of raw file content.
- For community troubleshooting context, use Answer Overflow tools.
- Reserve `gh` CLI for GitHub workflow operations (PRs, issues, checks, runs) and local repo metadata, not for reading documentation or searching code patterns.
- Reserve `webfetch` as a fallback for URLs that are not GitHub-hosted repos or indexed library docs.

## Go Automate Home Assistant Bridge Policy

- For Home Assistant entity watchers used by Waybar/scripts, use `go-automate ha bridge watch entity` by default.
- Treat `go-automate ha watch entity` direct-style usage as a fallback only when bridge mode is unavailable.
- Prefer `--waybar` output for machine-consumed flows; plain text output should be treated as human-facing unless explicitly needed.

## Skill Application

- For every code change, apply all matching OpenCode skills before editing.
- If a user asks for a local "rule" in OpenCode context, treat that as a request for the corresponding skill and use "skill" in new docs/config.
- If a change spans multiple scopes, apply all relevant skills together (not just one).
- Use the `write-a-skill` skill when adding or revising local OpenCode skills so descriptions, supporting files, and scripts stay minimal and consistent.
- Use the `skill-notes` skill alongside `import-external-skill` and `write-a-skill` when evaluating, importing, or recommending skills.
- Skills in `agents/.agents/skills/` are stowed globally (cross-project, shared by OpenCode + Codex via `~/.agents/skills/`). Skills in `.opencode/skills/` are repo-local (this repo only).

## Repo-Specific Skills

- For Effect-TS code (`effect`, `@effect/platform`, `Context.Tag`, `Layer`, `Effect.gen`), apply the `effect` skill.
- For OpenTUI code (`@opentui/core`, renderables, keyboard handling, suspend/resume), apply the `opentui` skill.

## Split Worktrees

- The current desktop/laptop split worktree repo is `hypr`.
- On `OMARCHY_HOST=desktop`: active worktree `~/.config/hypr` on branch `desktop`; laptop companion `~/.config/hypr-laptop` on branch `laptop`.
- On `OMARCHY_HOST=laptop`: active worktree `~/.config/hypr` on branch `laptop`; desktop companion `~/.config/hypr-desktop` on branch `desktop`.
- If this worktree layout changes, update all relevant `README.md`, `AGENTS.md`, and skill documentation together so repo instructions stay consistent.

## Stow Rules

- Repo root is a stow package root targeting `~/`.
- Top-level docs for humans/agents must be ignored by stow.
- Keep `.stowrc` ignore rules in sync when adding root-only files.
- **Always run `dot stow`** (or `dot update`, which refreshes stow) to apply packages. Do **not** invoke GNU `stow` directly from the repo root: `dot` applies the correct adopt/no-folding flow and public-then-private ordering.

## Dot Command Changes

- When editing files under `dot/`, always follow `dot/AGENTS.md` (validation steps, skills, patterns).
- When adding new `dot` subcommands that users may want quick access to, also add them to the menu registry in `dot/src/menu.ts`.

## Script Configuration Policy

- For dotfiles and system scripts, prefer explicit CLI flags over environment-variable toggles for runtime behavior.
- Use environment variables only for standard process context (`HOME`, `PATH`, `XDG_*`, etc.), secrets, or compatibility shims that already exist.
- For test/simulation/force behaviors, implement documented flags first; if an env fallback is temporarily needed, treat it as deprecated and remove it in follow-up cleanup.

## Validation

- Basic health check: `dot doctor`
- OpenCode debug wrapper: `dot opencode-debug`
- OpenCode context injection command: `/inject-context [instruction]`
- OpenCode planning command: `/plan [focus]` (manual entrypoint; some agents can also switch into plan mode via native `plan_enter`)
- OpenCode review command: `/review-current-work`
- OpenCode current-work refactor command: `/refactor-current-work [scope]`
- OpenCode investigation command: `/investigate <topic>`
- OpenCode exploration command: `/explore-codebase <topic>`
- OpenCode frontend debug command: `/debug-frontend <page or issue>`
- OpenCode fallow audit command: `/fallow-audit [workspace]`
- OpenCode fallow project analysis command: `/fallow-project-analyse [workspace]`
- GitHub notifications command: `dot git-notifications` (`--waybar`, `--list-threads`, and thread actions)
- Git diff behavior: `dot git-diff` (`dot diff` is a human compatibility alias)

## Safety

- Do not run destructive git commands unless explicitly requested.
- Do not commit or push unless explicitly requested.
- Preserve user changes in a dirty working tree; do not revert unrelated edits.

## Response Style

- End task updates with a short finish message: what changed, what was verified, and what remains (if anything).
