# DOTFILES AGENTS

Repository-specific instructions for coding agents working in this public dotfiles repo.

Keep shared cross-project agent behaviour in the global `~/.config/opencode/AGENTS.md`. This file should only describe this repo's source layout, stow workflow, repo-local commands, and validation expectations. Don't catalogue skills or commands here: skills self-document via their injected `description`, commands via their frontmatter and the generated docs reference. Keep only repo facts and routing those don't capture.

## Cloud Branch

- This is `distro/cloud`, a build for cloud agent environments, starting with Claude Code cloud sessions. It is `distro/ubuntu-server` with a cloud layer on top, so the Ubuntu Server Branch section below describes its base: where that section says "this branch" or "the server", it means `distro/ubuntu-server`.
- A cloud session VM never stows packages, runs `dot init` or starts services. The environment's setup script runs `cloud/setup.sh`, which clones this branch shallowly to `~/.config/dotfiles`, installs mise and the pinned toolchain, builds `dot` and runs `dot cloud setup`. The script has no GitHub credentials, so it can't clone the private dotfiles. The environment snapshots the result, so keep the script under the roughly five-minute cache limit and never let it exit non-zero, since that stops the session starting.
- `dot cloud setup` (`dot/src/commands/CloudSetup.ts`) links `~/.config/dotfiles-private` to the attached checkout at `/home/user/dotfiles-private` when there is one, links `~/.claude/settings.json` to `cloud/claude/settings.json`, writes `~/.claude/CLAUDE.md` from `cloud/claude/CLAUDE.md` followed by the private global AGENTS.md, and links the shared skills into `~/.claude/skills`.
- The cloud settings run `dot cloud session-start` as a SessionStart hook, once the session has GitHub access. It resets the public clone to the latest commit (rebuilding `dot` in the background when it moved), clones the private dotfiles, rewrites `CLAUDE.md`, and passes the global instructions in as additional context when the session started without them, since Claude Code reads `CLAUDE.md` before hooks run. The session's proxy only serves attached repositories, so when the private one isn't attached the context instead asks the agent to attach it with `add_repo` and re-run `dot cloud setup --force`.
- In a cloud session (`CLAUDE_CODE_REMOTE=true`), `dot/src/lib/cloudSession.ts` points tracked repositories at their attached checkouts under `/home/user`, matched by origin, and `dot pr list` uses REST for the attached repositories only, since GraphQL is blocked. Its stdout becomes session context, so it must print nothing but that JSON. Keep other hooks out of the cloud settings unless they work without stowed config: the desktop Claude Code hooks read the stowed OpenCode config and Plannotator.
- `.dot-private.yml` drops the server's `repos` machine filter so `dot repo` can look up every tracked repository, and `.dot-skills.yml` only excludes `pkexec-root`.
- Keep the cloud layer additive: new files under `cloud/` and new code, not edits to server files, so rebasing onto the server stays clean. The exception is removal: this branch deletes the stow packages a VM never uses (only `agents/`, `dotfiles-skills/` and `mise/` stay, as the build, tests and docs read them, plus the untracked `scripts/` build output) and the `dot git releases` watcher. When a rebase brings changes to anything removed, `git rm` it again rather than restoring it.
- Test `cloud/setup.sh` with a scratch `HOME` (`HOME=$(mktemp -d) bash cloud/setup.sh --ref <branch>`) rather than against a live session's `~/.claude`.

### Updating From The Server Branch

The branch rebases onto `origin/distro/ubuntu-server`; the Cloud rebase workflow does it when dispatched and opens a "Rebase distro/cloud onto the server branch" issue when it can't. Follow the same steps as Updating From The Desktop Branch below, with these changes:

- Look ahead and rebase against `origin/distro/ubuntu-server` instead of the desktop branch.
- Wanted: everything the server takes, apart from server-only machine setup that can't run in a cloud VM, such as systemd units, ufw rules and NAS power handling.
- Resolve blindly by keeping the cloud side, and push with `--force-with-lease`. The `cloud-rebase` skill has the steps.

## Ubuntu Server Branch

- This is `distro/ubuntu-server`, a headless build for an Ubuntu server. It has no desktop packages: no Hyprland, UWSM, Ghostty or Omarchy.
- Keep it terminal and service tooling only. Do not add packages that need a graphical session.
- The server (hostname `nas`, NVIDIA GPU) is not always on. Home Assistant powers it through `switch.nas`: `automation.server_turn_on_at_01_30` turns it on at 01:50 for the maintenance and backup window, and `automation.server_turn_off_at_05_30` runs `script.turn_off_nas_when_inactive` from 03:00, which cuts the power once `sensor.nas_activity` (active downloads) has been 0 for 2 minutes. Agent sessions and long jobs running then are cut off with it. Don't move scheduled jobs, reports or anything that must run reliably onto it; keep them on the machine that already owns them. Before changing its power, wake or sleep behaviour, read or change those through `ha-bridge` (`ha-bridge-cli` skill) rather than working around them locally. Treat it as a headless desktop, not a laptop.
- The server hosts Herdr for remote clients through `systemd/.config/systemd/user/herdr.service`.
- Sessions here run headless over SSH or Herdr, with no browser to open. Don't open Plannotator reviews or other local web UIs; report changes for review in chat instead.
- The desktop code (Omarchy, Hyprland, UWSM, Ghostty, pacman, AUR, browser) is removed from `dot/`, not gated. Don't add it back.
- Packages come from apt (`.dot-public-packages`) and the global mise config. Release `.deb` packages such as System Bridge are listed in `.dot-public-deb-releases.yml` and installed by `dot update system`.
- `.dot-skills.yml` lists the authored skills `dot` does not link on the server. Add desktop-only skills there as they appear.
- `.dot-private.yml` lists the private stow packages `dot` links on the server; the private repository stays on its main branch. A missing file stows all of them, an invalid one stows none, and packages dropped from the list are unstowed. Its `mcp.exclude` servers are disabled in the untracked `~/.config/opencode/opencode.jsonc` and left out of Claude Code by `dot mcp sync`, and the server clones (shallow), pulls and checks only the `dot-git.yml` repositories whose `machines` list includes its `repos.machine`; the private `dot-git.yml` and `mcp.yml` are otherwise shared as they are.
- `dot server serve` (`dot/src/server/`) serves the dashboard in `server/` (Vite, Lit, Tailwind). Pitchfork runs it as the `server` daemon in `pitchfork.toml`; manage it with the `serve:server*` mise tasks, and check the dashboard with `mise run server:typecheck ::: server:format:check ::: server:build`.

### Updating From The Desktop Branch

The branch rebases onto `origin/distro/arch-omarchy-quattro`. Look ahead before rebasing, bring in only what the server wants, and blindly ignore the rest.

1. Look ahead at what is coming:

   ```bash
   git fetch origin
   git log --oneline --stat HEAD..origin/distro/arch-omarchy-quattro
   git diff --name-status HEAD...origin/distro/arch-omarchy-quattro
   ```

2. Sort each incoming change:
   - Wanted: shared `dot` core, terminal tools, agent and OpenCode config, Herdr, services, docs framework, CI. Anything that would also work headless on Ubuntu.
   - Not wanted: anything for Omarchy, Hyprland, UWSM, Ghostty, Quickshell, pacman, AUR, browsers or a graphical session, and changes to code this branch removed.
3. Rebase with `git rebase origin/distro/arch-omarchy-quattro` (enable `rerere` so repeat resolutions replay).
4. Resolve wanted changes properly, adapting them to apt and systemd where needed.
5. Resolve everything else blindly without reading it: keep the server side. In a rebase the server commits are "theirs", so use `git checkout --theirs <path>`, and `git rm <path>` when the desktop changed a file this branch deleted.
6. After the rebase, delete unwanted files the desktop added without a conflict (the `A` lines from step 1), since they arrive silently.
7. Run the checks under Validation, then push with `--force-with-lease`. If `docs/src/content/docs/changes.md` conflicts, take either side: the Distro diff workflow regenerates and commits it after the push.

`distro/cloud` builds on this branch. Every push here starts the Cloud rebase workflow, which rebases it onto the result or opens its own issue; that branch's `AGENTS.md` and `cloud-rebase` skill own it.

## Scope

- This repo is the public dotfiles source at `~/.config/dotfiles`.
- Make changes here (not in `~/.config/*` live paths directly).
- Treat private overlays as optional and separate (`~/.config/dotfiles-private`).
- Keep personal machine checks, browser extension checks, private package manifests, and other user-specific data in `~/.config/dotfiles-private`; the public repo should only contain the reusable logic that reads those private configs.
- When following `@` project references, look for the matching checkout under `~/repos` before editing. If it exists there, that is the correct source path to change.
- The standalone `context` and `notes` repositories are independent products. Dotfiles may install them and consume their public CLI/MCP interfaces, but must not add dotfiles-owned behaviour, analytics, environment variables, or integration contracts to those repositories. Keep observation and orchestration in dotfiles unless a change is independently justified by the standalone product itself.

## Private Repositories

- Repository induction defaults live in optional private `dot-git-presets.yml`; shared code must not hardcode personal schedules or name prefixes.
- Per-repository selections live in private `dot-git.yml`.
- PR tracking is opt-in through `pull_requests.enabled` in private `dot-git.yml`; `dot pr list` owns polling and cached open PRs.
- Issue tracking is opt-in through `issues.enabled` in private `dot-git.yml`, with top-level `issues.exclude` rules hiding noise such as Renovate dashboards; `dot git issues` owns polling and cached open issues.
- Repository `opencode_mcp` lists in private `dot-git.yml` select MCP opt-ins. `dot mcp sync` owns the generated, Git-ignored `.opencode/opencode.jsonc` files in those checkouts.

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
- Skills source: [`timmo001/skills`](https://github.com/timmo001/skills), cloned by `dot` to `~/.local/share/dot/skills` (detached at the latest `main`) and linked into `~/.agents/skills/`

## Tooling

- The whole project is driven by **mise**. The single root `mise.toml` pins the toolchain (`node`, `bun`) and defines every dev task, including the root `lint` task and project namespaces (`dot:*`, `docs:*`, and `tests:*`). Prefer `mise run <task>` (for example `mise run lint`, `mise run dot:build`, `mise run docs:check`, or `mise run tests:integration`) as the canonical interface; `mise tasks` lists them.
- `mise.toml` is the source of truth for tool versions even without mise: anyone not using mise must still use the pinned versions and the same underlying commands each task wraps (do not substitute other versions or a different toolchain).
- The package manager and runtime is **bun** for every JS/TS package (`dot/` and `docs/`). Do not use npm, pnpm, or yarn for install, lockfile, or script commands. Use `bun install`, `bun add`, `bun update`, `bun run`, and `bunx` (or the `mise run` task wrappers).
- The tracked lockfile is `bun.lock` in each package (`dot/bun.lock`, `docs/bun.lock`); commit it after any dependency change. CI runs `bun install --frozen-lockfile` against it.
- Keep Renovate update grouping limited to standard presets except for the coordinated Effect runtime and OpenCode 2 packages in `renovate.json`. Keep Effect compiler tooling outside the runtime group.
- `tooling.yml` records the Herdr, gh, OpenCode and Effect releases the configuration, custom plugins and `dot` code were last reviewed against; the Tooling drift workflow opens a review pull request when one moves. After the review, move the pin with `mise run tooling:update <repo> <tag>`, never by hand; the `tooling-drift` skill has the steps.

## OpenCode Assets

- For human-written command names and command/docs prose in this repo, prefer UK spelling. Keep upstream tool, API, or MCP names unchanged when they use US spelling.
- `agents/.config/opencode/` contains the shared OpenCode config source published from this repo.
- `agents/.config/opencode/lib/` contains shared plugin support modules. Relative plugin imports must resolve before publication.
- Shared skills come from `timmo001/skills` `main`, not a submodule. `dot update` fetches the dot-owned checkout at `~/.local/share/dot/skills`, detaches it at `origin/main`, builds `skill-maintenance` from it, installs external imports and links each authored skill file into `~/.agents/skills/`. `dot stow` and `dot install` clone it when missing but do not fetch. Author shared skills and manage imports in the standalone checkout under `~/repos/skills`; `dot skills` runs there. Tool-owned skills live in `.agents/skills/` in their owning repository and are imported through `skills`. Never edit the managed checkout or `~/.agents/skills` directly.
- `herdr/.config/herdr/` stows the main config and selected plugin configuration; runtime logs, sockets, generated files, and session state stay untracked in `~/.config/herdr/`.
- `.agents/skills/` contains repo-local skills for this repo only and is registered through `skills.paths` in `opencode.json`. The tracked `.claude/skills` symlink points at it so Claude Code loads the same skills. Use `dotfiles-skills/.agents/skills/` only for global skills whose workflow is specifically coupled to dotfiles paths, commands, or private overlays. Shared cross-repository workflows belong in `~/repos/skills`; tool-owned skills belong in the tool repository and are tracked there as imports.
- Public `SKILL.md` files must satisfy the [Agent Skills](https://agentskills.io/specification) frontmatter rules. The standalone skills repo validates its own skills; this repo validates its local `.agents/skills/` and `dotfiles-skills/` roots.
- `dot agent sync` mirrors the global private AGENTS source into agent harness instruction files; full `dot update` and `dot init` run that sync automatically.
- Pinned private OpenCode packages, including plugins in `dotfiles-private/agents/.config/opencode/{opencode,tui}.json`, should be managed by an npm regex custom manager in `dotfiles-private/renovate.json`.
- Only add a command when it must force an agent profile or carry explicit authorisation (`/commit`, `/commit-push`). Everything else is a skill the model selects from its description.

## Stow Rules

- Repo root is a stow package root targeting `~/`.
- Top-level docs for humans/agents must be ignored by stow.
- The `docs/` site directory is ignored by stow (`--ignore=^/docs`); the repo root stows to `~/`, so any new root-level directory that should not be symlinked needs a matching `.stowrc` ignore.
- Keep `.stowrc` ignore rules in sync when adding root-only files.
- **Always run `dot stow`** (or `dot update`, which refreshes stow) to apply packages. Do **not** invoke GNU `stow` directly from the repo root: `dot` applies the correct adopt/no-folding flow and public-then-private ordering.

## Dot Command

`dot/` is the compiled CLI for the dotfiles manager, built with Bun and Effect v4 (`bun build --compile` to a single binary). It is excluded from stow via `--ignore=^/dot`; the binary outputs to `scripts/.local/bin/dot`, stowed to `~/.local/bin/dot`.

### Skills And Patterns

- Always apply `effect` and `types-enforce-ts` when editing code under `dot/`.
- All exported functions, classes, interfaces, types, and interface members need JSDoc. Use single-line JSDoc for simple members and multi-line for complex behaviour. Effect service tags reference the underlying service interface via `{@link}`.
- Services use `Context.Service` with a static `layer` property. Domain failures use `Schema.TaggedError`.
- Use `Effect.fn("Name")` for effectful functions with arguments, and `Effect.gen` with `Effect.withSpan("Name")` for named zero-argument effects.
- Use `Clock.currentTimeMillis` for testable timestamps. Top-level execution uses `Effect.runPromise`.
- Logging: section headings in Title Case, uppercase labels (`[INFO]`, `[WARN]`, `[ERROR]`), sentence-case messages.
- Debug startup logging with `DOT_DEBUG=1 dot 2>/tmp/dot.log`; debug lines are prefixed with `[dot]`.

### Layout

```text
dot/src/
  index.ts                - Effect CLI bootstrap and application layers
  types.ts                - Shared domain types
  cli/spec.ts             - Executable Effect command tree
  commands/               - Native dot command implementations
  doctor/                 - Health-check runner and checks
  git/                    - Git and GitHub commands and services
  mcp/                    - MCP config generation
  services/               - Config, CommandExecutor, Launcher, OutputLog and shared services
  lib/                    - Shared command support
```

`cli/spec.ts` defines typed arguments, flags, handlers, aliases, and subcommands; `index.ts` runs that tree with the shared Effect and Node layers. Bare `dot` and `dot --help` print root help. Commands use `Launcher`, `CommandExecutor`, and `OutputLog` for process and output handling.

### Command Changes

- When changing a command, alias, or flag: update `dot/src/cli/spec.ts`, rebuild with `mise run dot:build`, run `dot stow` to generate and apply completions, then regenerate the command reference with `mise run docs:gen:cli` (`docs/src/content/docs/dot/commands.md`; the `dot-build` workflow checks it is current).
- `dot update` compiles to a temporary path and atomically renames the result over the running binary to avoid `ETXTBSY`. Keep that behaviour when changing self-update code.
- Bounded external jobs use `ProcessRunner` through `dot run --timeout <duration> -- <command> [args...]`. Keep caller-specific arguments and permissions in the caller; the runner owns the deadline, signals, and process-group cleanup.
- Keep command and flag metadata in `dot/src/cli/spec.ts`; help and completion generation consume that registry.
- Generated `dot` and `skill-maintenance` completions are ignored by Git. Public `dot stow`, `dot install` (including `dot init`), and `dot update` generate them before stowing. Keep hand-written completions tracked; use package-provided completions for external tools such as `context`.

## Documentation

`docs/` is the Blume site at `dotfiles.timmo.dev`. It is a short personal reference: what each major part of the setup is, and why it exists. It is not a manual for every binding, flag, quirk, or script. Code, `--help`, and generated catalogues own the detail.

- Default: no docs update. Ordinary behaviour changes do not need a hand-written page edit.
- Hand-written pages stay short. Summarise and list. Do not document keybindings, close-first rules, edge cases, or runbooks that already live in source or CLI help.
- Do not add a page for every new script, binding, layout, app, or one-off tool.
- Update a hand-written page only when a whole section's purpose changes (a major area added, removed, or renamed), not when an implementation detail changes.
- Generated catalogues stay generated. Follow `docs/AGENTS.md` for their source paths and regeneration commands; include affected output in the changeset. Skills are catalogued in the standalone skills repository.
- `README.md` stays a slim pointer to the docs site.

## Script Configuration Policy

- Implement commands and non-trivial scripting in `dot/` using TypeScript and Effect. Do not add Python or other language implementations when the behaviour can live in `dot/`.
- Shell/Bash is fine for simple wrappers and commands with little or no logic.
- New config files read by `dot` use YAML, parsed with `Bun.YAML.parse` and decoded with Schema. Do not add new JSON configs; leave existing JSON formats alone unless the task is to migrate them.
- For dotfiles and system scripts, prefer explicit CLI flags over environment-variable toggles for runtime behavior.
- Use environment variables only for standard process context (`HOME`, `PATH`, `XDG_*`, etc.), secrets, or compatibility shims that already exist.
- For test/simulation/force behaviors, implement documented flags first; if an env fallback is temporarily needed, treat it as deprecated and remove it in follow-up cleanup.

## Testing

This is a personal dotfiles repo. Do not aim for coverage, and do not add a test suite for every command, flag, layout, app, or behaviour change.

- Default: no new tests. Validate by building, typing, formatting, and running the changed command or script, plus the existing regression suite listed under Validation.
- Effect and the typed CLI already constrain most `dot/` behaviour; do not re-simulate whole workflows in Bun tests.
- Add a test only for a durable edge case or a cross-cutting invariant that is easy to regress and hard to catch by hand (for example a known lock race, a ban on legacy dispatcher syntax, or a shared OpenCode contract).
- Prefer immutable, narrow checks under `tests/`. Do not grow large `dot/tests` suites that mirror `dot/src`.
- Never invent “representative” coverage, happy-path Effect walks, or per-app permutations when changing personal scripts or workspace layout.

## Validation

- Run only the checks the change needs, and run them in parallel. Pick the narrowest tasks that cover the touched files and pass them to a single `mise run`, separated by `:::` (for example `mise run lint:yaml ::: lint:actions` after a workflow edit). Don't run aggregate tasks such as `check` to cover a narrow change.
- After changing `dot/`, `tests/`, or OpenCode plugins, format first (it writes files), then run the rest in parallel before reporting done:

  ```bash
  mise run dot:format
  mise run dot:check ::: tests:integration
  ```

  `tests:integration` builds `dot` itself. `dot:check` only runs `dot/tests`. The regression tests that import `dot/src` live in `tests/` and only run through `tests:integration`, the CI `regression-tests` job.
- Run the changed command's relevant help or behaviour check. When command metadata changes, also add `tests:smoke` to the parallel run.
- Basic health check: `dot doctor`
- Aggregate tasks run their parts in parallel: `mise run check` runs every lint, dot check, test suite and the docs build, `mise run tests` runs every test suite, and `mise run lint` runs every linter. Use them for broad changes that genuinely touch all of those areas.
- Dev tasks: `mise run <task>` from the repo root. `mise run lint:oxlint` checks owned TypeScript and JavaScript with `@timmo001/oxlint-rules`. Project tasks are namespaced: `dot:*` (`dot:build`, `dot:typecheck`, `dot:test`, `dot:format`, `dot:check`), `docs:*` (`docs:build`, `docs:dev`, `docs:gen`, `docs:check`), `serve:docs*` for the background docs server (see `docs/AGENTS.md`), and `tests:*` (`tests:integration`, `tests:smoke`); `mise tasks` lists them.
- Skill frontmatter: the `lint.yml` `validate-skills` job validates public skills with the shared `lint-agent-skills` workflow.
- OpenCode validation: check `opencode debug --help` and run supported checks relevant to the change. V2 exposes `config`, `paths`, and `agents`; skill discovery uses the Skills CLI. Use the configured launcher so checks target the same environment as the session.
- MCP config sync: `dot mcp sync` regenerates each active agent harness's MCP config from the single private spec `dotfiles-private/mcp.yml`; some agent harnesses are documented stubs. Runs automatically in `dot update` before re-stow; run `dot stow` after a manual sync.
- Herdr: `herdr/.config/herdr/` stows the main config and selected plugin configuration into the runtime-owned `~/.config/herdr/` directory; `dot doctor` warns when Herdr or the OpenCode integration is missing and prints the manual repair command.

## After Committing

- When a change only takes effect on this machine through `dot update` (a rebuilt `dot`, a submodule or plugin bump, agent or MCP sync, or anything else `dot update` regenerates), offer "Run `dot update`" in the next-steps question alongside commit and push. `dot update` pulls from the remote, so it needs the push first; say so when the user picks it without pushing.
