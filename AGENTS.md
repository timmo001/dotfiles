# DOTFILES AGENTS

Repository-specific instructions for coding agents working in this public dotfiles repo.

Keep shared cross-project agent behaviour in the global `~/.config/opencode/AGENTS.md`. This file should only describe this repo's source layout, stow workflow, repo-local commands, and validation expectations. Don't catalogue skills or commands here: skills self-document via their injected `description`, commands via their frontmatter and the generated docs reference. Keep only repo facts and routing those don't capture.

## Scope

- This repo is the public dotfiles source at `~/.config/dotfiles`.
- Make changes here (not in `~/.config/*` live paths directly).
- Treat private overlays as optional and separate (`~/.config/dotfiles-private`).
- Keep personal machine checks, browser extension checks, private package manifests, and other user-specific data in `~/.config/dotfiles-private`; the public repo should only contain the reusable logic that reads those private configs.
- When following `@` project references, look for the matching checkout under `~/repos` before editing. If it exists there, that is the correct source path to change.
- The standalone `context` and `notes` repositories are independent products. Dotfiles may install them and consume their public CLI/MCP interfaces, but must not add dotfiles-owned behaviour, analytics, environment variables, or integration contracts to those repositories. Keep observation and orchestration in dotfiles unless a change is independently justified by the standalone product itself.

## Private Repositories

- The global "Private Repos And Files" policy governs the public/private split and the git-remote visibility check; this repo just consumes it, reading optional private config such as `dot-git.yml`, `.dot-browser-checks`, and private package config files.

## Key Paths

- Main entrypoint: `scripts/.local/bin/dot` (compiled binary from `dot/src/`)
- Source: `dot/` (Bun + Effect v4 + OpenTUI; excluded from stow)
- TypeScript tests: `dot/tests/` (mirrors `dot/src/`)
- Repository integration tests: `tests/` (grouped by area; excluded from stow)
- Docs site: `docs/` (Astro + Starlight, bun; excluded from stow; deploys to `dotfiles.timmo.dev`)
- Stow config: `.stowrc`
- Readme: `README.md` (slim pointer; links to the docs site, which is the canonical human documentation)
- OpenCode config source: `agents/.config/opencode/`
- Skills source: `agents/.agents/skills/` (stows to `~/.agents/skills/`)
- Published OpenCode config: [`timmo001/opencode-config`](https://github.com/timmo001/opencode-config)

## Tooling

- The whole project is driven by **mise**. The single root `mise.toml` pins the toolchain (`node`, `bun`) and defines every dev task, namespaced by project (`dot:*`, `docs:*`, `tests:*`, and `skills:*`). Prefer `mise run <task>` (for example `mise run dot:build`, `mise run docs:check`, `mise run tests:integration`, `mise run skills:validate`) as the canonical interface; `mise tasks` lists them.
- `mise.toml` is the source of truth for tool versions even without mise: anyone not using mise must still use the pinned versions and the same underlying commands each task wraps (do not substitute other versions or a different toolchain).
- The package manager and runtime is **bun** for every JS/TS package (`dot/` and `docs/`). Do not use npm, pnpm, or yarn for install, lockfile, or script commands. Use `bun install`, `bun add`, `bun update`, `bun run`, and `bunx` (or the `mise run` task wrappers).
- The tracked lockfile is `bun.lock` in each package (`dot/bun.lock`, `docs/bun.lock`); commit it after any dependency change. CI runs `bun install --frozen-lockfile` against it.

## OpenCode Assets

- For human-written command names and command/docs prose in this repo, prefer UK spelling. Keep upstream tool, API, or MCP names unchanged when they use US spelling.
- `agents/.config/opencode/` contains the shared OpenCode config source published from this repo.
- `agents/.config/opencode/lib/` contains shared plugin support modules. Relative plugin imports must resolve before publication.
- `agents/.agents/skills/` contains globally stowed skills exposed via `~/.agents/skills/`.
- `herdr/.config/herdr/` contains the shared Herdr config.
- `.opencode/skills/` contains repo-local skills for this repo only.
- Public `SKILL.md` files under `agents/.agents/skills/` and `.opencode/skills/` must satisfy the [Agent Skills](https://agentskills.io/specification) frontmatter rules. Validate with `mise run skills:validate` (`.github/scripts/validate-skills.sh`); CI runs the same check as the dedicated `validate-skills` job in `lint.yml`.
- `dot agents-sync` mirrors the global private AGENTS source into agent harness instruction files; full `dot update` and `dot init` run that sync automatically.
- Pinned private OpenCode packages, including plugins in `dotfiles-private/agents/.config/opencode/{opencode,tui}.json`, should be managed by an npm regex custom manager in `dotfiles-private/renovate.json`.

### OpenCode Layer Boundaries

- Commands are routing prompts: identify the user-facing intent, map `${ARGUMENTS}` to the target, name required skills or injected context, and define the output shape. Keep command-specific safety constraints visible.
- Agents own execution posture: permissions, tool access, delegation defaults, and whether native plan mode is allowed. Do not duplicate reusable domain workflows in agent prompts.
- Skills own reusable workflows and behavioural contracts. Prefer updating a skill when the same guidance would otherwise be repeated across commands or agents.
- Plugins provide context, evidence, or enforcement hooks. Commands opt into plugin-provided context, and skills define how to consume it.
- AGENTS guidance should stay to invariant repo policy, source-of-truth rules, and routing conventions rather than step-by-step command workflows.

## Repo-Specific Skills

- The repo-relevant skills are `effect` (Effect v4 code in `dot/`) and `opentui` (OpenTUI code in `dot/`); both self-document their triggers.

## Omarchy Host Overrides

- Hyprland config is a stowed dotfiles package (`hypr/.config/hypr/`, conf-only), not a tracked Omarchy repo.
- `waybar` and `uwsm` are single-branch Omarchy repos expected on `main`.
- `ghostty` is a stowed package (`ghostty/.config/ghostty/`) with `config.$OMARCHY_HOST` overrides loaded by `ghostty-host-config`.
- `bootstrap` is expected on `distro/omarchy`.
- Hypr host-specific overrides live under `~/.config/hypr/hosts/$OMARCHY_HOST`, selected by the runtime `~/.config/hypr/host` symlink.
- `dot stow` lays down the Hypr package with `--no-folding` and creates/repairs `~/.config/hypr/host`; `dot doctor` checks the host link and flags any leftover legacy `omarchy-hypr` clone.
- A machine still on the retired `~/.config/hypr` `omarchy-hypr` clone halts `dot update` until the clone is backed up and re-stowed.
- If this host override layout changes, update the docs site (`docs/src/content/docs/`), `README.md`, `AGENTS.md`, and skill documentation together so repo instructions stay consistent.

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
- When changing `dot` commands, subcommands, aliases, or flags, run `dot completions` for each supported shell after rebuilding so the stowed completion files stay in sync.
- The `docs/` command reference (`docs/src/content/docs/dot/commands.md`) is generated from `dot/src/cli/spec.ts`. After changing commands, regenerate it with `mise run docs:gen:cli` (alongside shell completions) and commit the result.

## Documentation Site

- `docs/` is the Astro + Starlight site published to `dotfiles.timmo.dev`; it is the single source of truth for human documentation. `README.md` links to it rather than duplicating content.
- Treat a docs update as part of the change, not a follow-up. Any commit that changes documented behaviour (commands, flags, workflows, paths, config, stow packages, or user-facing scripts) must update the relevant page under `docs/src/content/docs/` in the same commit. The docs site is canonical: do not document new or changed behaviour only in `README.md` or code comments.
- Which docs to touch for a given change:
  - `dot` command, subcommand, or flag: edit `dot/src/cli/spec.ts` (regenerates `dot/commands.md`), update the matching hand-written page (`dot/`, `git/`, or `omarchy/`), and run `dot completions`.
  - OpenCode agent, command, skill, or plugin: edit the asset under `agents/**` (regenerates `reference/*.md`), and update `opencode/index.mdx` if the user-facing summary changes.
  - New stow package or user-facing script (for example `topgrade/` or a `scripts/.local/bin/*` tool): add or extend a hand-written page under `configuration/`, `dot/`, `omarchy/`, or `getting-started/`. Generated pages never cover these.
  - Environment variables, XDG paths, or install/bootstrap steps: `configuration/environment.md`, `getting-started/install.md`, `getting-started/new-machine.mdx`.
  - Hypr host-override layout: `omarchy/host-overrides.md`.
- Two sections are generated, not hand-written: `docs/src/content/docs/dot/commands.md` (from `dot/src/cli/spec.ts` via `mise run docs:gen:cli`) and `docs/src/content/docs/reference/{agents,commands,skills,plugins}.md` (from the OpenCode assets via `mise run docs:gen:opencode`). Edit the sources, then run `mise run docs:gen` and commit the result; never hand-edit the generated pages.
- CI enforces generated pages on pull requests and direct pushes: `docs-drift`, `tui-build`, and `opencode-publish` regenerate the relevant reference pages and fail when the committed output is stale. Regenerate with `mise run docs:gen` and commit the result before pushing. Hand-written pages are not auto-checked, so the mapping above is on you.
- Dev tasks for `dot/`, `docs/`, repository integration tests, and skill validation are defined in the single root `mise.toml`, namespaced by project (`dot:*`, `docs:*`, `tests:*`, and `skills:*`; run `mise tasks` to list them). Package tasks set their own `dir` and wrap the matching `bun run` script, so `bun run build` etc. still work; CI (`tui-build`, `opencode-publish`, `docs-drift`, `lint.yml` `validate-skills`) and the fresh-machine bootstrap rely on that. Use **bun** in `docs/` for dependencies (`bun install`); `mise run docs:build` (wrapping `bun run build`) runs `starlight-links-validator`, so broken internal links fail the build.

## Script Configuration Policy

- For dotfiles and system scripts, prefer explicit CLI flags over environment-variable toggles for runtime behavior.
- Use environment variables only for standard process context (`HOME`, `PATH`, `XDG_*`, etc.), secrets, or compatibility shims that already exist.
- For test/simulation/force behaviors, implement documented flags first; if an env fallback is temporarily needed, treat it as deprecated and remove it in follow-up cleanup.

## Validation

- Basic health check: `dot doctor`
- Dev tasks: `mise run <task>` from the repo root, namespaced by project - `dot:*` (`dot:build`, `dot:typecheck`, `dot:test`, `dot:format`, `dot:check`), `docs:*` (`docs:build`, `docs:dev`, `docs:gen`, `docs:check`), `tests:*` (`tests:integration`, `tests:smoke`), and `skills:*` (`skills:validate`); `mise tasks` lists them.
- Skill frontmatter: `mise run skills:validate` runs `.github/scripts/validate-skills.sh` against public skills with `skills-ref`.
- OpenCode debug: use `opencode debug` subcommands directly, for example `opencode debug config`, `opencode debug skill`, or `opencode debug agent <name>`.
- MCP config sync: `dot mcp-sync` regenerates each active agent harness's MCP config from the single private spec `dotfiles-private/mcp.yml`; some agent harnesses are documented stubs. Runs automatically in `dot update` before re-stow; run `dot stow` after a manual sync.
- Herdr: the shared Herdr config is stowed from `herdr/.config/herdr/`; `dot doctor` warns when Herdr or the OpenCode integration is missing and prints the manual repair command.
- OpenCode slash commands and `dot` git subcommands self-document (command frontmatter, `dot --help`) and are catalogued in the generated docs reference (`reference/commands.md`, `dot/commands.md`); don't re-document them here. The global AGENTS.md routes the behavioural ones (`/plan`, `/grill`, `/commit`, `/inject-context`, `/code-review`).
