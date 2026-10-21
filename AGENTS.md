# DOTFILES AGENTS

Repository-specific instructions for coding agents working in this public dotfiles repo.

Keep shared cross-project agent behaviour in the global `~/.config/opencode/AGENTS.md`. This file should only describe this repo's source layout, stow workflow, repo-local commands, and validation expectations. Don't catalogue skills or commands here: skills self-document via their injected `description`, commands via their frontmatter and the generated docs reference. Keep only repo facts and routing those don't capture.

## Cloud Branch

- This is `distro/cloud`, a build for cloud agent environments, starting with Claude Code cloud sessions. It is `distro/ubuntu-server` with a cloud layer on top, so the Ubuntu Server Branch section below describes its base: where that section says "this branch" or "the server", it means `distro/ubuntu-server`.
- A cloud session VM never stows packages, runs `dot init` or starts services. The environment's setup script runs `cloud/setup.sh`, which clones this branch shallowly to `~/.config/dotfiles`, installs mise and the pinned toolchain, builds `dot` and runs `dot cloud setup`. The script has no GitHub credentials, so it can't clone the private dotfiles. The environment snapshots the result, so keep the script under the roughly five-minute cache limit and never let it exit non-zero, since that stops the session starting.
- `dot cloud setup` (`dot/src/commands/CloudSetup.ts`) links `~/.config/dotfiles-private` to the attached checkout at `/home/user/dotfiles-private` when there is one, links `~/.claude/settings.json` to `cloud/claude/settings.json`, writes `~/.claude/CLAUDE.md` from `cloud/claude/CLAUDE.md` followed by the private global AGENTS.md, and links the shared skills into `~/.claude/skills`.
- The cloud settings run `dot cloud session-start` as a SessionStart hook, once the session has GitHub access. It resets the public clone to the latest commit (rebuilding `dot` in the background when it moved), clones the private dotfiles, rewrites `CLAUDE.md`, and passes the global instructions in as additional context when the session started without them, since Claude Code reads `CLAUDE.md` before hooks run. Its stdout becomes session context, so it must print nothing but that JSON. Keep other hooks out of the cloud settings unless they work without stowed config: the desktop Claude Code hooks read the stowed OpenCode config and Plannotator.
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
- Sessions here run headless over SSH or Herdr, with no browser to open. Plannotator is off: the server has no Plannotator binaries, code, Herdr plugins or keys, and `.dot-private.yml` removes the private config's OpenCode plugin and loads `agents/.config/opencode/instructions/server.md`, which says to report in chat. Don't add Plannotator back here, and treat incoming Plannotator changes from the desktop as not wanted.
- The desktop code (Omarchy, Hyprland, UWSM, Ghostty, pacman, AUR, browser) is removed from `dot/`, not gated. Don't add it back.
- Packages come from apt (`.dot-public-packages`) and the global mise config. Release `.deb` packages such as System Bridge are listed in `.dot-public-deb-releases.yml` and installed by `dot up`.
- `.dot-skills.yml` lists the authored skills `dot` does not link on the server. Add desktop-only skills there as they appear.
- `.dot-private.yml` lists the private stow packages `dot` links on the server; the private repository stays on its main branch. A missing file stows all of them, an invalid one stows none, and packages dropped from the list are unstowed. Its `mcp.exclude` servers are disabled in the untracked `~/.config/opencode/opencode.jsonc` and left out of Claude Code by `dot mcp sync`, which also writes its `opencode` plugin operations and instruction files into that layer, and the server clones (shallow), pulls and checks only the `dot-git.yml` repositories whose `machines` list includes its `repos.machine`; the private `dot-git.yml` and `mcp.yml` are otherwise shared as they are.
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
   - Not wanted: anything for Omarchy, Hyprland, UWSM, Ghostty, Quickshell, pacman, AUR, browsers, Plannotator or a graphical session, and changes to code this branch removed.
3. Rebase with `git rebase origin/distro/arch-omarchy-quattro` (enable `rerere` so repeat resolutions replay).
4. Resolve wanted changes properly, adapting them to apt and systemd where needed.
5. Resolve everything else blindly without reading it: keep the server side. In a rebase the server commits are "theirs", so use `git checkout --theirs <path>`, and `git rm <path>` when the desktop changed a file this branch deleted.
6. After the rebase, delete unwanted files the desktop added without a conflict (the `A` lines from step 1), since they arrive silently.
7. Run the checks under Validation, then push with `--force-with-lease`. If `docs/src/content/docs/changes.md` conflicts, take either side: the Distro diff workflow regenerates and commits it after the push.

`distro/cloud` and `distro/opencode-app` build on this branch, in permanent worktrees at `~/.local/share/dot/dotfiles-cloud` and `~/.local/share/dot/dotfiles-opencode-app`. Each branch's `AGENTS.md` owns what it takes. Rebase them with `git rebase --fork-point origin/distro/ubuntu-server`, so only their own commits replay after this branch is force-pushed; a plain `git rebase origin/distro/ubuntu-server` replays the old server commits too.

`dot up branch` runs last in `dot up`. When any of these branches is behind, it opens an OpenCode agent named `branch-update` in Herdr to follow these steps and push. Commits that only regenerate the distro diff page don't count as behind. It never opens one under an agent, during a rebase, or while `branch-update` is open; `--no-branch` skips it.

## Scope

- This repo is the public dotfiles source at `~/.config/dotfiles`.
- Make changes here (not in `~/.config/*` live paths directly).
- Treat private overlays as optional and separate (`~/.config/dotfiles-private`).
- `~/.config/dotfiles-private` is for private files and non-public info only: personal machine checks, browser extension checks, private package manifests, and other personal data, read by public logic. Host-specific config that reveals nothing private (GPU settings, host overrides, `<package>--<host>` packages) stays public.
- When following `@` project references, look for the matching checkout under `~/repos` before editing. If it exists there, that is the correct source path to change.
- The standalone `context` and `notes` repositories are independent products. Dotfiles may install them and consume their public CLI/MCP interfaces, but must not add dotfiles-owned behaviour, analytics, environment variables, or integration contracts to those repositories. Keep observation and orchestration in dotfiles unless a change is independently justified by the standalone product itself.

## Private Repositories

- Optional private config drives per-user behaviour; shared code must not hardcode it. `dot-git-presets.yml` holds induction defaults. `dot-git.yml` holds repositories, opt-in `pull_requests` and `issues` tracking, and `opencode_mcp` per-repository MCP and `opencode_skills` skill on and off overrides (rendered by `dot mcp sync` into Git-ignored `.opencode/opencode.jsonc`).

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
- `tooling.yml` records the releases of the third-party tools the configuration, custom plugins, Code Mode `cli-tools` and `dot` code were last reviewed against; a newly wrapped third-party CLI gets an entry there; the Tooling drift workflow opens a review pull request when one moves. After the review, move the pin with `mise run tooling:update <repo> <tag>`, never by hand; the `tooling-drift` skill has the steps.

## OpenCode Assets

- Prefer UK spelling in human-written command names and prose; keep upstream names unchanged.
- `agents/.config/opencode/` is the shared OpenCode config source. Relative plugin imports from `lib/` must resolve before publication.
- Shared skills come from `timmo001/skills` `main` (see Key Paths); `dot update` refreshes and relinks them. `.agents/skills/` holds this repo's own skills (also linked from `.claude/skills`), and `dotfiles-skills/.agents/skills/` holds global skills tied to dotfiles paths or commands. Public `SKILL.md` files must satisfy the [Agent Skills](https://agentskills.io/specification) frontmatter rules.
- `herdr/.config/herdr/` stows the main Herdr config and selected plugin config; runtime state stays untracked.
- `dot agent sync` mirrors the private global AGENTS source into harness instruction files; `dot update` and `dot init` run it.
- Pin private OpenCode packages through the npm regex custom manager in `dotfiles-private/renovate.json`.
- Only add a command when it must force an agent profile or carry explicit authorisation (`/commit`, `/commit-push`). Everything else is a skill.

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

`docs/` is the Blume site at `dotfiles.timmo.dev`: a short reference for what each major part is and why. Default to no docs update; `dotfiles-docs` owns when a page changes, and `docs/AGENTS.md` owns generated catalogues. `README.md` stays a slim pointer.

## Script Configuration Policy

- Non-trivial scripting goes in `dot/` (TypeScript and Effect), not Python or other languages. Plain shell is fine for simple wrappers.
- New config files read by `dot` use YAML (`Bun.YAML.parse` plus Schema). Leave existing JSON formats alone unless migrating them.
- Prefer explicit CLI flags over environment-variable toggles. Use environment variables only for standard process context, secrets, or existing compatibility shims.

## Testing

Personal dotfiles: don't aim for coverage. Default to no new tests; validate by building, typing, formatting and running the changed command, plus the regression suite under Validation. Add a narrow test under `tests/` only for a durable edge case or cross-cutting invariant that is easy to regress and hard to catch by hand (a known lock race, a ban on legacy syntax, a shared OpenCode contract). Don't grow `dot/tests` to mirror `dot/src` or invent happy-path coverage.

## Validation

- Run only the checks the change needs, and run them in parallel. Pick the narrowest tasks that cover the touched files and pass them to a single `mise run`, separated by `:::` (for example `mise run lint:yaml ::: lint:actions` after a workflow edit). Don't run aggregate tasks such as `check` to cover a narrow change.
- After changing `dot/`, `tests/`, or OpenCode plugins, format first (it writes files), then run the rest in parallel before reporting done:

  ```bash
  mise run dot:format
  mise run dot:check ::: tests:integration
  ```

  `tests:integration` builds `dot` itself. `dot:check` only runs `dot/tests`. The regression tests that import `dot/src` live in `tests/` and only run through `tests:integration`, the CI `regression-tests` job.
- Run the changed command's relevant help or behaviour check. When command metadata changes, also add `tests:smoke` to the parallel run.
- `hk.pkl` runs the lint, `dot:typecheck` and `dot:format:check` tasks for changed file types on pre-push (hk's global hooks, installed by `dot update`). Run them by hand with `hk check`.
- Basic health check: `dot doctor`. `mise tasks` lists every task; aggregates (`check`, `tests`, `lint`) are for broad changes only.
- MCP config sync: `dot mcp sync` renders every harness's MCP config from private `dotfiles-private/mcp.yml`; `dot update` runs it, and a manual sync needs `dot stow` after.

## After Committing

- When a change only takes effect on this machine through `dot update` (a rebuilt `dot`, a submodule or plugin bump, agent or MCP sync, or anything else `dot update` regenerates), offer "Run `dot update`" in the next-steps question alongside commit and push. `dot update` pulls from the remote, so it needs the push first; say so when the user picks it without pushing.
