# DOTFILES AGENTS

Repository-specific instructions for coding agents working in this public dotfiles repo.

Keep shared cross-project agent behaviour in the global `~/.config/opencode/AGENTS.md`. This file should only describe this repo's source layout, stow workflow, repo-local commands, and validation expectations.

## Scope

- This repo is the public dotfiles source at `~/.config/dotfiles`.
- Make changes here (not in `~/.config/*` live paths directly).
- Treat private overlays as optional and separate (`~/.config/dotfiles-private`).
- Keep personal machine checks, browser extension checks, private package manifests, and other user-specific data in `~/.config/dotfiles-private`; the public repo should only contain the reusable logic that reads those private configs.

## Private Repositories

- Before adding repo-specific logic, paths, or checks to this public repo, determine whether the target repository is public or private.
- For repository visibility, check the git remote and hosting visibility instead of assuming from the folder name or local path.
- Keep private repository lists, private package manifests, browser checks, and other machine-specific repo metadata in `~/.config/dotfiles-private`.
- In this public repo, keep only the shared logic that reads optional private repo config such as `dot-git.yml`, `.dot-browser-checks`, or future private package config files.

## Key Paths

- Main entrypoint: `scripts/.local/bin/dot` (compiled binary from `dot/src/`)
- Source: `dot/` (Bun + Effect v4 + OpenTUI; excluded from stow)
- Docs site: `docs/` (Astro + Starlight, bun; excluded from stow; deploys to `dotfiles.timmo.dev`)
- Stow config: `.stowrc`
- Main docs: `README.md`
- OpenCode config source: `agents/.config/opencode/`
- Skills source: `agents/.agents/skills/` (stows to `~/.agents/skills/`; shared by OpenCode + Codex)
- Published OpenCode config: [`timmo001/opencode-config`](https://github.com/timmo001/opencode-config)

## OpenCode Assets

- For human-written command names and command/docs prose in this repo, prefer UK spelling. Keep upstream tool, API, or MCP names unchanged when they use US spelling.
- `agents/.config/opencode/` contains the shared OpenCode config source published from this repo.
- `agents/.agents/skills/` contains globally stowed skills shared by OpenCode and Codex via `~/.agents/skills/`.
- `.opencode/skills/` contains repo-local skills for this repo only.
- `dot agents-sync` mirrors the global private AGENTS source into Cursor rules; `dot update` and `dot git-diff` run that sync by default (`DOT_AGENTS_SYNC_ON_*`).

### OpenCode Layer Boundaries

- Commands are routing prompts: identify the user-facing intent, map `${ARGUMENTS}` to the target, name required skills or injected context, and define the output shape. Keep command-specific safety constraints visible.
- Agents own execution posture: permissions, tool access, delegation defaults, and whether native plan mode is allowed. Do not duplicate reusable domain workflows in agent prompts.
- Skills own reusable workflows and behavioural contracts. Prefer updating a skill when the same guidance would otherwise be repeated across commands or agents.
- Plugins provide context, evidence, or enforcement hooks. Commands opt into plugin-provided context, and skills define how to consume it.
- AGENTS guidance should stay to invariant repo policy, source-of-truth rules, and routing conventions rather than step-by-step command workflows.

## Repo-Specific Skills

- For Effect-TS code (`effect`, `@effect/platform`, `Context.Tag`, `Layer`, `Effect.gen`), apply the `effect` skill.
- For OpenTUI code (`@opentui/core`, renderables, keyboard handling, suspend/resume), apply the `opentui` skill.

## Omarchy Host Overrides

- Hyprland config is a stowed dotfiles package (`hypr/.config/hypr/`, conf-only), not a tracked Omarchy repo.
- `waybar`, `ghostty`, and `uwsm` are single-branch Omarchy repos expected on `main`.
- `bootstrap` is expected on `distro/omarchy`.
- Hypr host-specific overrides live under `~/.config/hypr/hosts/$OMARCHY_HOST`, selected by the runtime `~/.config/hypr/host` symlink.
- `dot stow` lays down the Hypr package with `--no-folding` and creates/repairs `~/.config/hypr/host`; `dot doctor` checks the host link and flags any leftover legacy `omarchy-hypr` clone.
- A machine still on the retired `~/.config/hypr` `omarchy-hypr` clone halts `dot update` until the clone is backed up and re-stowed.
- If this host override layout changes, update all relevant `README.md`, `AGENTS.md`, and skill documentation together so repo instructions stay consistent.

## Stow Rules

- Repo root is a stow package root targeting `~/`.
- Top-level docs for humans/agents must be ignored by stow.
- The `docs/` site directory is ignored by stow (`--ignore=^/docs`); the repo root stows to `~/`, so any new root-level directory that should not be symlinked needs a matching `.stowrc` ignore.
- Keep `.stowrc` ignore rules in sync when adding root-only files.
- **Always run `dot stow`** (or `dot update`, which refreshes stow) to apply packages. Do **not** invoke GNU `stow` directly from the repo root: `dot` applies the correct adopt/no-folding flow and public-then-private ordering.

## Dot Command Changes

- When editing files under `dot/`, always follow `dot/AGENTS.md` (validation steps, skills, patterns).
- When adding new `dot` subcommands that users may want quick access to, also add them to the menu registry in `dot/src/menu.ts`.
- Keep command and flag metadata in `dot/src/cli/spec.ts`; help and completion generation consume that registry.
- When changing `dot` commands, subcommands, aliases, or flags, run `dot completions zsh` after rebuilding so the stowed Zsh completion file stays in sync.
- The `docs/` command reference (`docs/src/content/docs/dot/commands.md`) is generated from `dot/src/cli/spec.ts`. After changing commands, regenerate it with `bun run gen:cli` in `docs/` (alongside `dot completions zsh`) and commit the result.

## Documentation Site

- `docs/` is the Astro + Starlight site published to `dotfiles.timmo.dev`; it is the single source of truth for human documentation. `README.md` links to it rather than duplicating content.
- Two sections are generated, not hand-written: `docs/src/content/docs/dot/commands.md` (from `dot/src/cli/spec.ts` via `bun run gen:cli`) and `docs/src/content/docs/reference/{agents,commands,skills,plugins}.md` (from the OpenCode assets via `bun run gen:opencode`). Edit the sources, not the generated pages.
- The `opencode-publish` workflow regenerates and commits the OpenCode reference pages when the assets change; `tui-build` regenerates and commits the command reference when `dot/src/cli/spec.ts` changes.
- Use **bun** in `docs/` (`bun install`, `bun run dev`, `bun run build`). `bun run build` runs `starlight-links-validator`; broken internal links fail the build.

## Script Configuration Policy

- For dotfiles and system scripts, prefer explicit CLI flags over environment-variable toggles for runtime behavior.
- Use environment variables only for standard process context (`HOME`, `PATH`, `XDG_*`, etc.), secrets, or compatibility shims that already exist.
- For test/simulation/force behaviors, implement documented flags first; if an env fallback is temporarily needed, treat it as deprecated and remove it in follow-up cleanup.

## Validation

- Basic health check: `dot doctor`
- OpenCode debug wrapper: `dot opencode-debug`
- OpenCode context injection command: `/inject-context [instruction]`
- OpenCode planning command: `/plan [focus]` (manual entrypoint; some agents can also switch into plan mode via native `plan_enter`)
- OpenCode grilling command: `/grill [focus]` (extended one-question-at-a-time plan stress-testing before `/plan` or implementation)
- OpenCode review command: `/review-current-work`
- OpenCode current-work refactor command: `/refactor-current-work [scope]`
- OpenCode investigation command: `/investigate <topic>`
- OpenCode exploration command: `/explore-codebase <topic>`
- OpenCode frontend debug command: `/debug-frontend <page or issue>`
- OpenCode fallow audit command: `/fallow-audit [workspace]`
- OpenCode fallow project analysis command: `/fallow-project-analyse [workspace]`
- GitHub notifications command: `dot git-notifications` (`--bar-json`, `--list-threads`, and thread actions)
- Git diff behavior: `dot git-diff` (`dot diff` is a human compatibility alias)
- Git status command: `dot git-status` (unstaged, staged, and recent commits with timestamps and remote push status in one shot; substitutes `git status`, `git diff --stat`/`git diff --numstat`, `git diff --cached --stat`, `git log --oneline --stat`, and `git log @{upstream}..HEAD`). Add `--diff` for full unstaged and staged diffs, and `--branch-diff` for the full merge-base diff against the default branch (errors on the default branch).
