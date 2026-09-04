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
- Source: `dot/` (Bun + Effect v4 CLI; excluded from stow)
- TypeScript tests: `dot/tests/` (excluded from stow; usually empty)
- Repository tests: `tests/` (excluded from stow)
- Docs site: `docs/` (Blume, bun; excluded from stow; deploys to `dotfiles.timmo.dev`)
- Stow config: `.stowrc`
- Readme: `README.md` (slim pointer; links to the docs site, which is the canonical human documentation)
- OpenCode config source: `agents/.config/opencode/`
- Skills source: [`timmo001/skills`](https://github.com/timmo001/skills), pinned at `agents/.agents/skills/` and stowed to `~/.agents/skills/`
- Published OpenCode config: [`timmo001/opencode-config`](https://github.com/timmo001/opencode-config)

## Tooling

- The whole project is driven by **mise**. The single root `mise.toml` pins the toolchain (`node`, `bun`) and defines every dev task, including the root `lint` task and project namespaces (`dot:*`, `docs:*`, and `tests:*`). Prefer `mise run <task>` (for example `mise run lint`, `mise run dot:build`, `mise run docs:check`, or `mise run tests:integration`) as the canonical interface; `mise tasks` lists them.
- `mise.toml` is the source of truth for tool versions even without mise: anyone not using mise must still use the pinned versions and the same underlying commands each task wraps (do not substitute other versions or a different toolchain).
- The package manager and runtime is **bun** for every JS/TS package (`dot/` and `docs/`). Do not use npm, pnpm, or yarn for install, lockfile, or script commands. Use `bun install`, `bun add`, `bun update`, `bun run`, and `bunx` (or the `mise run` task wrappers).
- The tracked lockfile is `bun.lock` in each package (`dot/bun.lock`, `docs/bun.lock`); commit it after any dependency change. CI runs `bun install --frozen-lockfile` against it.
- Keep Renovate update grouping limited to standard presets except for the coordinated OpenCode 2 beta packages in `renovate.json`. Do not add other repository-defined `groupName` rules.

## OpenCode Assets

- For human-written command names and command/docs prose in this repo, prefer UK spelling. Keep upstream tool, API, or MCP names unchanged when they use US spelling.
- `agents/.config/opencode/` contains the shared OpenCode config source published from this repo.
- `agents/.config/opencode/lib/` contains shared plugin support modules. Relative plugin imports must resolve before publication.
- `agents/.agents/skills/` is the `timmo001/skills` submodule and exposes its skills via `~/.agents/skills/`. Create, import, review, and update every reusable skill in the standalone checkout under `~/repos/skills`, even when first requested from this repo. Never edit the submodule checkout or `~/.agents/skills` directly. After every committed or upstream-updated skills revision, update and commit the pinned submodule revision here; do not leave the repositories out of sync.
- `herdr/.config/herdr/` stows the main config and selected plugin configuration; runtime logs, sockets, generated files, and session state stay untracked in `~/.config/herdr/`.
- `.agents/skills/` contains repo-local skills for this repo only and is registered through `skills.paths` in `opencode.json`. Use `dotfiles-skills/.agents/skills/` only for global skills whose workflow is specifically coupled to dotfiles paths, commands, or private overlays; tool-specific or cross-repository workflows belong in `~/repos/skills`.
- Public `SKILL.md` files must satisfy the [Agent Skills](https://agentskills.io/specification) frontmatter rules. The standalone skills repo validates `agents/.agents/skills/`; this repo validates its local `.agents/skills/` root.
- `dot agents-sync` mirrors the global private AGENTS source into agent harness instruction files; full `dot update` and `dot init` run that sync automatically.
- Pinned private OpenCode packages, including plugins in `dotfiles-private/agents/.config/opencode/{opencode,tui}.json`, should be managed by an npm regex custom manager in `dotfiles-private/renovate.json`.

### OpenCode Layer Boundaries

- Commands are routing prompts: identify the user-facing intent, map `${ARGUMENTS}` to the target, name required skills or injected context, and define the output shape. Keep command-specific safety constraints visible.
- Agents own execution posture: permissions, tool access, delegation defaults, and whether native plan mode is allowed. Do not duplicate reusable domain workflows in agent prompts.
- Skills own reusable workflows and behavioural contracts. Prefer updating a skill when the same guidance would otherwise be repeated across commands or agents.
- Plugins provide context, evidence, or enforcement hooks. Commands opt into plugin-provided context, and skills define how to consume it.
- AGENTS guidance should stay to invariant repo policy, source-of-truth rules, and routing conventions rather than step-by-step command workflows.

## Repo-Specific Skills

- The repo-relevant skills are `effect` (Effect v4 code in `dot/`) and `omarchy-shell-quickshell` (Omarchy shell / Quickshell work in this repo); both self-document their triggers.

## Omarchy Host Overrides

- Hyprland config is a stowed dotfiles package (`hypr/.config/hypr/`), not a tracked Omarchy repo.
- All custom Omarchy shell plugin IDs, directory names, QML `moduleName` values, and IPC targets use the `timmo.` prefix. Do not introduce personal or alternative namespaces such as `aidan.`.
- After any Omarchy shell configuration or plugin change, reload the running shell with `omarchy restart shell`; do not rely solely on automatic reloads.
- UWSM custom environment values are stowed from `uwsm/.config/uwsm/env.d/90-dotfiles`; Quattro owns the defaults under `/usr/share`.
- `ghostty` is a stowed package (`ghostty/.config/ghostty/`) with `config.$OMARCHY_HOST` overrides loaded by `ghostty-host-config`.
- Hypr host-specific overrides live under `~/.config/hypr/hosts/$OMARCHY_HOST`, selected by the runtime `~/.config/hypr/host` symlink.
- `dot stow` lays down the Hypr package with `--no-folding` and creates/repairs `~/.config/hypr/host`; `dot doctor` checks the host link and flags any leftover legacy `omarchy-hypr` clone.
- The Hypr package alone is stowed non-destructively: `dot stow` and `dot install` skip the usual unstow-then-restow for `hypr` so its symlinks (notably `hyprland.lua`) never vanish mid-stow, then reload Hyprland afterwards. This stops Hyprland's live-config autoreload from catching a missing config and dropping into emergency mode. Keep this behaviour if you touch the stow loop in `dot/src/commands/{Stow,Install}.ts`.
- A machine still on the retired `~/.config/hypr` `omarchy-hypr` clone halts `dot update` until the clone is backed up and re-stowed.
- `dot stow` and `dot install` remove the retired `timmo001/omarchy-uwsm` checkout before the `uwsm` package takes ownership; Quattro-generated migration files are not copied into this repo.
- If this host override layout changes, update `AGENTS.md` and any skill that owns the workflow. Do not expand the docs site to cover every host detail.

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
- The Omarchy bar `shell.json` is generated by `dot/src/lib/omarchyShellConfig.ts`; the `dot update` loop reloads the running shell only when the rendered `shell.json` changes and forces `QT_QPA_PLATFORM=wayland` on the restart so the layer-shell bar attaches. Keep this behaviour if you touch `reloadOmarchyShell` in `dot/src/commands/Update.ts` or the shell-config return value. See the `omarchy-shell-quickshell` skill.
- Third-party Omarchy plugins managed through `omarchy plugin add` are Git submodules under `omarchy/.config/omarchy/plugins/`; `omarchy-plugins.json` owns their persistent bar placement. Add, update, and remove leave ordinary unstaged changes for review.

## Documentation

`docs/` is the Blume site at `dotfiles.timmo.dev`. It is a short personal reference: what each major part of the setup is, and why it exists. It is not a manual for every binding, flag, quirk, or script. Code, `--help`, and generated catalogues own the detail.

- Default: no docs update. Ordinary behaviour changes do not need a hand-written page edit.
- Hand-written pages stay short. Summarise and list. Do not document keybindings, close-first rules, edge cases, or runbooks that already live in source or CLI help.
- Do not add a page for every new script, binding, layout, app, or one-off tool.
- Update a hand-written page only when a whole section's purpose changes (a major area added, removed, or renamed), not when an implementation detail changes.
- Generated catalogues stay generated: `docs/src/content/docs/dot/commands.md` from `dot/src/cli/spec.ts`, and `docs/src/content/docs/reference/{agents,commands,skills,plugins}.md` from OpenCode assets. After those sources change, regenerate with `mise run docs:gen` and commit the result; never hand-edit the generated pages. CI (`docs-drift`, `dot-build`, `opencode-publish`) fails on stale generated output.
- When `dot` command metadata changes, regenerate the CLI reference and shell completions; do not expand hand-written prose to mirror every flag.
- `README.md` stays a slim pointer to the docs site.

## Script Configuration Policy

- For dotfiles and system scripts, prefer explicit CLI flags over environment-variable toggles for runtime behavior.
- Use environment variables only for standard process context (`HOME`, `PATH`, `XDG_*`, etc.), secrets, or compatibility shims that already exist.
- For test/simulation/force behaviors, implement documented flags first; if an env fallback is temporarily needed, treat it as deprecated and remove it in follow-up cleanup.

## Testing

This is a personal dotfiles repo. Do not aim for coverage, and do not add a test suite for every command, flag, layout, app, or behaviour change.

- Default: no new tests. Validate by building, typing, formatting, and running the changed command or script.
- Effect and the typed CLI already constrain most `dot/` behaviour; do not re-simulate whole workflows in Bun tests.
- Add a test only for a durable edge case or a cross-cutting invariant that is easy to regress and hard to catch by hand (for example a known lock race, a ban on legacy dispatcher syntax, or a shared OpenCode contract).
- Prefer immutable, narrow checks under `tests/`. Do not grow large `dot/tests` suites that mirror `dot/src`.
- Never invent “representative” coverage, happy-path Effect walks, or per-app permutations when changing personal scripts or workspace layout.

## Validation

- Basic health check: `dot doctor`
- Dev tasks: `mise run <task>` from the repo root. `mise run lint` checks owned TypeScript and JavaScript with `@timmo001/oxlint-rules`. Project tasks are namespaced: `dot:*` (`dot:build`, `dot:typecheck`, `dot:test`, `dot:format`, `dot:check`), `docs:*` (`docs:build`, `docs:dev`, `docs:gen`, `docs:check`), and `tests:*` (`tests:integration`, `tests:smoke`); `mise tasks` lists them.
- Skill frontmatter: the `lint.yml` `validate-skills` job validates public skills with the shared `lint-agent-skills` workflow.
- OpenCode debug: use `opencode debug` subcommands directly, for example `opencode debug config`, `opencode debug skill`, or `opencode debug agent <name>`.
- MCP config sync: `dot mcp-sync` regenerates each active agent harness's MCP config from the single private spec `dotfiles-private/mcp.yml`; some agent harnesses are documented stubs. Runs automatically in `dot update` before re-stow; run `dot stow` after a manual sync.
- Herdr: `herdr/.config/herdr/` stows the main config and selected plugin configuration into the runtime-owned `~/.config/herdr/` directory; `dot doctor` warns when Herdr or the OpenCode integration is missing and prints the manual repair command.
- OpenCode slash commands and `dot` git subcommands self-document (command frontmatter, `dot --help`) and are catalogued in the generated docs reference (`reference/commands.md`, `dot/commands.md`); don't re-document them here. The global AGENTS.md routes the behavioural ones (`/plan`, `/grill`, `/commit`, `/inject-context`, `/code-review`).
