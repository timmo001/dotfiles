---
title: Command Reference
description: Every dot command, alias, flag and example, generated from the CLI command tree.
sidebar:
  order: 2
---

<!-- Generated from dot/src/cli/spec.ts by `mise run docs:gen:cli`. Do not edit by hand. -->

This page lists every `dot` command from the same Effect command tree that powers parsing, help, dispatch, and shell completions.

## `dot init`

Run one-time first-use machine setup

```text
dot init [flags]
```

Run the one-time first-use setup workflow for a fresh machine. Init prepares repos, stow links, mise tools, packages, and machine hooks, and trusts mise configs in tracked repos. After init completes, reboot so the Omarchy session picks up host env, then run dot doctor. Before the bounded workflow starts, init updates or clones the optional private overlay according to DOT_ALLOW_PRIVATE. Use dot update for ongoing maintenance.

**Options**

| Option | Description |
| --- | --- |
| `--noninteractive` | Skip the Hypr host questionnaire for this run |
| `--interactive` | Enable the Hypr host questionnaire when no host is selected |
| `--force` | Re-run init even if the machine looks initialised |
| `--host` `<string>` | Hypr host to link before stow |
| `--log` `<path>` | Init log path (default: ~/.local/state/dot/init.log) |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot init --noninteractive
dot init --host laptop --noninteractive
dot init --force --noninteractive
```

## `dot install`

Ensure prerequisites, then backup/adopt dotfiles

```text
dot install [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

## `dot update`

Aliases: `dot up`

Self-update, pull repos, stow dotfiles, rebuild. Phase flags are inclusive: passing any of --pull, --stow, or --app runs only the selected phases. Internal --no-self-update, --post-hook-repo and --started-at flags support the active self-update handoff; internal --summary-file lets update system print the summary last.

```text
dot update <subcommand> [flags]
```

A full update pulls the public dotfiles, installs Bun dependencies, rebuilds and relaunches dot, then scans and pulls tracked repositories, trusting mise configs only in repositories it freshly clones. It moves the dot-managed skills checkout to the latest skills main before rebuilding skill-maintenance. Pulls are fast-forward-only and never stash or rebase: Git refuses an update if local edits would be overwritten or histories have diverged. It regenerates completions, installs missing public Arch/AUR packages, runs the required MCP sync, stows, rebuilds again, runs agents sync, backfills the init marker, and refreshes shell modules. The shell restarts only when its generated config or a deployed Omarchy plugin changed. It finishes with a summary of updated repositories and every completed or skipped step, in order.

Phase flags are inclusive: passing any of --pull, --stow, or --app runs only the selected phases. Scoped runs skip full-update package reconciliation, agents sync, and init-marker backfill.

Use --repo PATH (repeatable) to pull selected repositories, restore their pinned submodules and run configured post-update commands after HEAD changes. Changed public or private dotfiles also rebuild, stow and sync agent instructions once per batch. Add --pull to only pull and run post-update commands, skipping the dotfiles rebuild and stow. Herdr plugins are refreshed only inside Herdr. The Git panel uses --no-reload to skip shell reload and module refresh.

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Fast-forward this repository when local work can be preserved, then run its post-update command; repeat for a batch. Changed dotfiles also rebuild and stow |
| `--pull` | Run the repository pull phase only |
| `--stow` | Generate completions, sync MCP configs, and stow only |
| `--app` | Install Bun dependencies and rebuild the dot binary only |
| `--check` | Report dotfiles pulls, pending pins and stow changes, skipping local work |
| `--check-all` | Also check development repos for pulls, skipping local work |
| `--no-self-update` | Skip the internal self-update phase |
| `--no-reload` | Skip shell reload and module refresh |
| `--post-hook-repo` `<string>` | Internal post-hook repository |
| `--summary-file` `<string>` | Internal: write the final summary to this file instead of printing it |
| `--started-at` `<integer>` | Internal: epoch ms the run started, for the summary timing |
| `--help` `-h` | Show help information |

**Exit codes**

```text
0   Update completed, or no actionable updates were found
1   Fatal workflow failure
2   Update check could not finish
10  Update check found pulls, pending pins or stow changes
11  Legacy Hypr migration is required
```

### `dot update system`

Select and run Dotfiles, Omarchy, and Topgrade updates

```text
dot update system [flags]
```

Select maintenance steps interactively, then run them in order: Dotfiles, Omarchy, GitHub CLI extensions, and Topgrade. Interactive runs pre-select Dotfiles, Omarchy, and GitHub CLI extensions; extra Topgrade steps start unselected. Non-interactive runs and --yes select every step. Cancelling the prompt exits without running updates.

**Options**

| Option | Description |
| --- | --- |
| `--yes` | Select every update without prompting |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot update system
dot update system --yes
```

## `dot deps`

Validate and publish grouped native dependency updates

```text
dot deps <subcommand> [flags] [<repository>]
```

Read native policy and manifests from a pinned remote target, preserving the caller's checkout. Exclude whole groups covered by any open dependency PR, including failed, pending and draft PRs. --all bypasses only PR inventory and exclusion. --dry-run discovers updates without repository scripts, installs, checks or writes to Git. Bare dot deps starts groups by priority and prepares and validates them concurrently in isolated worktrees, bounded by --concurrency. Check commands share the same concurrency cap across groups; setup and shared Git operations are serialised. A command's optional skipFor exclusions apply only when every updated dependency matches; mixed or unknown groups retain checks. The first ready group takes the publication slot and publishes one checked commit without creating PRs or waiting for hosted CI. Host permissions are read from $XDG_CONFIG_HOME/dot/dependencies.yml (default ~/.config/dot/dependencies.yml), keyed by owner/repository with trusted and allowBypass booleans. Required hosted checks must have equivalent validation.checks mappings; protected direct pushes require explicit allowBypass permission and existing account rights. Workflow edits require a credential with workflow write access. Unsupported policy remains blocking. Git-backed claims serialise each repository/target across machines and service or manual runs. Publication atomically advances the ownership record and target; target movement rebuilds and revalidates, up to three attempts per group. Failed work and per-group logs remain under $XDG_STATE_HOME/dot/dependencies. Clean published worktrees are removed, including submodules. Setup/check mutations and commit-hook mutations prevent publication. Independent groups continue after failures, including groups sharing files; a partial run exits non-zero. A normal invocation authorises passing updates, regardless of Renovate automerge policy.

**Options**

| Option | Description |
| --- | --- |
| `--dry-run` | Discover updates without running scripts, installing packages or publishing |
| `--all` | Bypass open-PR inventory and exclusion only; leave PRs untouched |
| `--target` `<string>` | Remote target branch (default: repository default branch) |
| `--timeout` `<string>` | Deadline per command/provider lookup (default: 30 seconds) |
| `--concurrency` `<integer>` | Maximum concurrent groups, lookups, PR inspections or check commands, 1-16 (default: 4) |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<repository>` | repository |

**Examples**

```bash
dot deps --dry-run
dot deps owner/repository --dry-run
dot deps --dry-run --all --target main
```

### `dot deps service`

Run one cross-machine dependency service interval

```text
dot deps service [flags]
```

Run configured repositories sequentially under one Git-backed service claim. Configuration supplies coordinationRepository, repositories, intervalMinutes and concurrency. Every repository requires host trust. Shared state prevents overlapping machine runs and records the next eligible interval. Repository/target claims also cover manual dot deps runs. Claims renew every 30 seconds and expire after two minutes; a lost claim interrupts work, and dependency publication atomically checks its target claim. State is stored on dedicated dot-deps-state branches. The user timer runs hourly at ten past, except between 01:00 and 07:00. Exit status 2 means completed with unsuccessful update groups (warning); 3 means the shared interval was skipped. --no-cooldown ignores the shared interval and each repository's interval but never an active claim; `dot services start dot-deps.timer` applies it to that one start automatically. Startup, policy and service failures exit 1. Local configuration validation with --dry-run performs no remote writes. Policy is read from published target commits, so repository policies must be pushed before enabling the service.

**Options**

| Option | Description |
| --- | --- |
| `--config` `<string>` | Service YAML config (default: $XDG_CONFIG_HOME/dot/dependency-service.yml) |
| `--dry-run` | Validate local service configuration and trust without running updates or writing to Git |
| `--no-cooldown` | Run even if the shared interval is not due; an active claim still blocks the run |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot deps service --dry-run
dot deps service
dot deps service --no-cooldown
```

### `dot deps import`

Import dependency policy from other tools

```text
dot deps import <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot deps import renovate`

Import Renovate policy into dot-deps.yml with an editor schema

```text
dot deps import renovate [flags] [<directory>]
```

Create dot-deps.yml and its editor schema from a repository's JSON Renovate config, migrating an existing dot-deps.json policy. The first import resolves presets with an isolated, pinned Renovate runtime. Later imports replace explicit override sections, including edits within them, while preserving the native base policy and local check mappings. Unsupported settings are recorded as publication blockers. Importing creates no commits or PRs. Ordinary previews use the saved native policy without running Renovate or refreshing presets.

**Options**

| Option | Description |
| --- | --- |
| `--source` `<string>` | Repository-relative Renovate JSON file (default: renovate.json) |
| `--timeout` `<string>` | Deadline per import pass (default: 5 minutes) |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<directory>` | directory |

**Examples**

```bash
dot deps import renovate
dot deps import renovate /path/to/repository
```

## `dot run`

Run a command with a deadline and process-group cleanup

```text
dot run [flags] <command> [<args...>]
```

Pass the executable and its arguments after --. Standard input, output and errors are inherited. Completion, timeout and SIGINT/SIGTERM/SIGHUP all release the owned process group, first with SIGTERM and then SIGKILL after the cleanup grace period. Use foreground commands: processes that deliberately leave the group or send work to an existing server are outside this ownership. For isolated OpenCode jobs, pass run --standalone.

**Options**

| Option | Description |
| --- | --- |
| `--timeout` `<string>` | Execution deadline, for example '5 minutes' or '30 seconds' |
| `--kill-after` `<string>` | Cleanup grace period before SIGKILL (default: 5 seconds) |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<command>` | Executable to run after -- |
| `<args>` | Arguments passed unchanged to the command |

**Exit codes**

```text
Child exit code on completion
124  Execution deadline exceeded
125  Process execution failed
128 + signal number on interruption
```

**Examples**

```bash
dot run --timeout '5 minutes' -- opencode2 run --standalone 'Process this capture'
```

## `dot http`

Local HTTP helpers

```text
dot http <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot http forward`

Forward HTTP and websockets to another server without proxy headers

```text
dot http forward [flags]
```

Listens on 127.0.0.1 and forwards HTTP requests and websockets to the target origin, dropping Host and X-Forwarded-* headers so a server that doesn't trust this machine as a proxy accepts them. Use it behind a local HTTPS proxy, such as a pitchfork daemon, to reach a plain HTTP server from an HTTPS page.

**Options**

| Option | Description |
| --- | --- |
| `--port` `<integer>` | Local port to listen on, bound to 127.0.0.1 |
| `--target` `<string>` | Origin to forward to, such as http://host:8123 |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot http forward --port 8126 --target http://homeassistant.local:8123
```

## `dot status`

Run work under a pinned terminal status header

```text
dot status <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot status run`

Run a command or pitchfork daemon under a pinned status header

```text
dot status run [flags] [<command...>]
```

Pins a header to the top of the terminal with the state (Setting up, Starting, Running, Done, Stopped or Failed), the URL and the elapsed time, and keeps the terminal title in step with a spinner while work is in progress. --setup runs in an interactive zsh first. With --pitchfork, an already running daemon prompts before restarting (--attach follows it instead), its logs are followed once it is ready, and Ctrl+C stops it. --background returns once the daemon is ready. Without a TTY, state changes print as lines.

**Options**

| Option | Description |
| --- | --- |
| `--title` `<string>` | Name shown in the header and terminal title |
| `--url` `<string>` | URL pinned in the header |
| `--via` `<string>` | What serves the URL when it is not this command, shown beside it |
| `--setup` `<string>` | zsh command run first, under the Setting up state |
| `--pitchfork` `<string>` | Pitchfork daemon to start and follow instead of a command |
| `--conflicts` `<string>` | Pitchfork daemon that cannot run alongside --pitchfork or the command; asks to stop it first. Repeat for more |
| `--attach` | Follow an already running --pitchfork daemon instead of asking to restart it |
| `--background` | Return once the pitchfork daemon is ready, leaving it running |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<command>` | Command and arguments to run after -- |

**Examples**

```bash
dot status run --title 'Lint' -- pnpm lint
dot status run --title 'Core' --url https://dev.example.localhost --setup 'script/bootstrap' --pitchfork core/dev
```

## `dot updates`

Check watched package, Dotfiles and skills updates for the status bar

```text
dot updates <subcommand> [flags]
```

Read cached status immediately and refresh it in the background after 15 minutes. Refresh checks watched repository/AUR packages, all dot-managed repositories and whether the managed skills checkout is behind timmo001/skills main, writes the cache atomically under a shared lock, and notifies the Omarchy shell. status --json prints the cached sections and the bar and footer output for other readers such as the OpenCode skill-updates plugin. Scheduled refreshes respect AUR HTTP-error backoff; manual refreshes retry immediately. Use --package-file, --cache-dir and --timeout to override defaults.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot updates status
dot updates refresh
```

### `dot updates status`

Print cached status-bar JSON and refresh stale data in the background

```text
dot updates status [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--json` | Print cached dotfiles, skills and package sections, and the bar and footer output, as JSON |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot updates status
dot updates status --json
```

### `dot updates refresh`

Refresh package, Dotfiles and skills status and notify the shell

```text
dot updates refresh [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--package-file` `<path>` | Watched package list (default: public dotfiles manifest) |
| `--cache-dir` `<path>` | Status cache directory (default: XDG status-bar cache) |
| `--timeout` `<integer>` | Maximum seconds for each external check |
| `--scheduled` | Respect the AUR request backoff |
| `--dot-only` | Refresh only Dotfiles status, keeping cached package status |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot updates refresh
dot updates refresh --dot-only
```

## `dot services`

Monitor registered systemd user services and timers

```text
dot services <subcommand> [flags]
```

Each job registers itself with a YAML descriptor in ~/.config/dot/services.d/, shipped by the stow package that owns the unit. A descriptor names the unit and its monitoring policy: label, history, failAfter (consecutive failures before a job counts as failed), staleAfter (a duration such as "1 hour", counted from the latest of the last completed run, the last boot or resume, and one interval before the first calendar run due after those, so sleep, power off and gaps in the schedule are not missed runs), restartLimit ({ count, within }) for long-running services, notify, logs ({ dir, file }) for jobs that keep their own run logs, and repository (a GitHub owner/repo slug from dot-git.yml) naming the repository that logs and agents open in. A long-running service can add status ({ file }) pointing at a JSON file it writes with health ("ok", "warning", "degraded" or "failed"), summary and updated (epoch milliseconds); while systemd sees the service as healthy, a report from its current run replaces the health and summary. Without repository, the repository containing the unit's executable is used, falling back to the public dotfiles. Optional exitStatuses maps non-zero exit codes to "warning" or "skipped", for example { "2": "warning", "3": "skipped" }. Warnings break the failure streak and count as completed work for staleness; skipped invocations retain the last completed outcome. These are monitor classifications; systemd still records non-zero exits. Run history comes from the user journal. A job can summarise each run by printing a line containing "[RESULT] " followed by a short outcome; the last such line per invocation becomes that run's summary in status, run logs, notifications and the timmo.services panel. Units with OnFailure=dot-service-failed@%n.service call dot services notify, which raises a desktop notification once failAfter is reached and refreshes the timmo.services panel. Timer services with ExecCondition=dot services schedule check run only at their calendar times, not as catch-up runs after boot or resume; those runs show as skipped. dot services start always runs them.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot services status
dot services logs dot-deps.timer
```

### `dot services status`

Show the health of registered user services

```text
dot services status [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--json` | Print the full snapshot as JSON |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot services status
dot services status --json
```

### `dot services start`

Run a registered job now, or restart a long-running service

```text
dot services start [flags] <unit>
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<unit>` | Registered timer or service unit |

**Examples**

```bash
dot services start dot-deps.timer
```

### `dot services stop`

Stop a registered job's running service, leaving its timer scheduled

```text
dot services stop [flags] <unit>
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<unit>` | Registered timer or service unit |

**Examples**

```bash
dot services stop notes-capture-daemon.service
```

### `dot services logs`

Open a registered job's logs in a Herdr tab for the repository that owns it

```text
dot services logs [flags] <unit>
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<unit>` | Registered timer or service unit |

**Examples**

```bash
dot services logs notes-capture-daemon.service
```

### `dot services run`

Inspect a registered job's recent runs

```text
dot services run <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot services run logs`

Print the journal output of a registered job's most recent runs, newest first, with its latest run log

```text
dot services run logs [flags] <unit>
```

**Options**

| Option | Description |
| --- | --- |
| `--count` `<integer>` | Number of recent runs to include |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<unit>` | Registered timer or service unit |

**Examples**

```bash
dot services run logs dot-deps.timer
dot services run logs skill-updates-agent.timer --count 5 | wl-copy
```

### `dot services investigate`

Open an agent in a registered job's repository, briefed with its recent runs, logs, file locations and commands to investigate them

```text
dot services investigate [flags] <unit>
```

**Options**

| Option | Description |
| --- | --- |
| `--agent` `<string>` | Installed launcher from dot herdr agents, such as opencode2 |
| `--modifiers` `<integer>` | Qt keyboard modifier bitmask, as for dot herdr repo open |
| `--print` | Print the investigation brief instead of opening the agent |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<unit>` | Registered timer or service unit |

**Examples**

```bash
dot services investigate skill-updates-agent.timer --agent opencode2
```

### `dot services notify`

Notify when a registered job has failed (used by OnFailure=)

```text
dot services notify [flags] <unit>
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<unit>` | Registered timer or service unit |

**Examples**

```bash
dot services notify dot-deps.service
```

### `dot services schedule`

Timer schedule checks for registered jobs

```text
dot services schedule <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot services schedule check`

Skip a timer's catch-up run after boot or resume (used by ExecCondition=)

```text
dot services schedule check [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot services schedule check
```

## `dot fans`

Control chassis fans from a Home Assistant temperature

```text
dot fans <subcommand> [flags]
```

Reads ~/.config/dot/fans.yml: entity (a Home Assistant temperature sensor), device (a liquidctl --match string), channels (a list such as fan1 and fan2), ramp ({ from, to } in °C) and speed ({ min, max } in percent). Watches the entity through ha-bridge and ramps the channels linearly from speed.min at ramp.from to speed.max at ramp.to, in 5% steps. An unavailable or non-numeric reading, no reading within 30 seconds, or a stopped watcher sets speed.max until readings resume; the watcher restarts after 15 seconds. Health is written to $XDG_STATE_HOME/dot/fans/status.json for the status field of a dot services descriptor. Stopping hands the device back to motherboard control with liquidctl initialize.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot fans run
```

### `dot fans run`

Control chassis fans from a Home Assistant temperature (used by dot-fans.service)

```text
dot fans run [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot fans run
```

## `dot stow`

Re-stow public/private dotfiles

```text
dot stow [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--public` | Stow public dotfiles only |
| `--private` | Stow private dotfiles only |
| `--help` `-h` | Show help information |

## `dot omarchy`

Manage Omarchy plugins and the shell layout

```text
dot omarchy <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot omarchy plugin`

Manage Omarchy plugin submodules. The manage-omarchy-plugin compatibility wrapper may pass trailing 0/1 confirmation and commit-offer values to update and remove.

```text
dot omarchy plugin <subcommand> [flags]
```

Import, update, or remove Omarchy plugins managed as dotfiles submodules. The Omarchy plugin lifecycle hook calls this command through the manage-omarchy-plugin compatibility wrapper.

For a repository that keeps its plugin in a subfolder, pass add --path with that folder. The submodule holds the whole repository, and the registry's path entry tells stow and update which folder to validate and deploy.

sync components copies the shared panel components in omarchy/.config/omarchy/components into the plugin directories set by omarchy_components entries in the private dot-git.yml, since published plugins cannot import files from dotfiles. Pass --check to report out-of-date copies without writing.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Exit codes**

```text
0   Managed operation completed or was skipped
1   Managed operation failed
20  Plugin is unmanaged; continue with Omarchy's normal operation
```

**Examples**

```bash
dot omarchy plugin update timmo.clock --yes
dot omarchy plugin remove timmo.clock
dot omarchy plugin sync components --check
```

#### `dot omarchy plugin add`

Import a validated plugin checkout

```text
dot omarchy plugin add [flags] <id> <url> <checkout>
```

**Options**

| Option | Description |
| --- | --- |
| `--path` `<string>` | Plugin directory inside the checkout, for repositories that keep the plugin in a subfolder |
| `--section` `<choice>` | (choices: left, center, right) |
| `--before` `<string>` | Place before this plugin |
| `--after` `<string>` | Place after this plugin |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<id>` | Plugin ID |
| `<url>` | Plugin Git remote |
| `<checkout>` | Validated live plugin checkout |

#### `dot omarchy plugin update`

Update one or all managed plugins

```text
dot omarchy plugin update [flags] [<id>] [<confirm>]
```

**Options**

| Option | Description |
| --- | --- |
| `--yes` | Update without confirmation |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<id>` | Managed plugin ID |
| `<confirm>` | Compatibility confirmation value |

#### `dot omarchy plugin remove`

Remove a managed plugin

```text
dot omarchy plugin remove [flags] <id> [<confirm>] [<save>]
```

**Options**

| Option | Description |
| --- | --- |
| `--yes` | Remove without confirmation |
| `--no-commit-offer` | Do not offer the optional git commit handoff |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<id>` | Managed plugin ID |
| `<confirm>` | Compatibility confirmation value |
| `<save>` | Compatibility commit-offer value |

#### `dot omarchy plugin sync`

Sync shared files into plugin checkouts

```text
dot omarchy plugin sync <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot omarchy plugin sync components`

Copy shared panel components into standalone plugin checkouts

```text
dot omarchy plugin sync components [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--check` | Report out-of-date copies without writing |
| `--help` `-h` | Show help information |

### `dot omarchy shell`

Manage the Omarchy shell

```text
dot omarchy shell <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot omarchy shell config`

Regenerate the Omarchy shell layout

```text
dot omarchy shell config [flags]
```

Regenerate ~/.config/omarchy/shell.json from Omarchy's shipped default and the host-specific dotfiles layout without running the full stow flow.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot omarchy shell config
```

## `dot session`

Inspect agent sessions

```text
dot session <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot session status`

Query an OpenCode 2 session's model, variant and context pressure

```text
dot session status [flags] <session-id>
```

Read-only OpenCode 2 session inspection through the configured launcher. Pass the exact session ID supplied in the agent's environment context; it is not inferred from the focused pane, working directory or a guessed shell variable. Reports the selected model and variant, supported variants, model limits, latest completed assistant token measurement, its age, the latest completed compaction, and separately labelled cumulative usage and cost. Context tokens include non-cached input, cache reads and writes, output and reasoning, matching OpenCode's display. Input usage includes non-cached and cached input. Pressure uses whichever percentage is higher: context-window usage or input-limit usage. Current usage is unknown after compaction without a new measurement, after a model/variant switch, or with a staged revert. Later tool results and messages are not counted. Looks back through at most 20 messages per type and marks incomplete lookups. --warn-at defaults to 70 percent: a workflow heuristic, not a proven cognitive degradation threshold. The command does not change models, compact or open sessions.

**Options**

| Option | Description |
| --- | --- |
| `--warn-at` `<number>` | Context or input percentage prompting a scope or handoff review (default: 70) |
| `--json` | Print model, limits, context measurement and cumulative usage as JSON |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<session-id>` | Exact OpenCode 2 session ID from the agent's injected context |

**Examples**

```bash
dot session status ses_example --json
dot session status ses_example --warn-at 80
```

## `dot snapshot`

Save a CPU and memory snapshot with process rankings

```text
dot snapshot [flags]
```

Print a Markdown CPU and memory summary with a usage-filtered process tree. --sort mem defaults to an 80 MiB measured subtree PSS cutoff; --sort cpu defaults to 1% of one core. Adjust these with --min-memory-mib and --min-cpu. Each tree row shows aligned memory and CPU totals beside the process name. Totals include hidden children, so small workers can qualify together; parent and child totals overlap. Expand the largest remaining qualifying branch until --limit visible processes are reached (default: 40, including ancestors). Zero-usage branches are omitted. The saved report adds CPU, memory and process-name rankings with the same cutoffs and per-table limit, plus pressure measurements. Interactive human runs open it in $EDITOR (vi if unset). The internal dot agent detect check automatically selects JSON. JSON retains all sampled processes and the complete processTree, and reportSelection identifies visible PIDs, cutoffs, the limit and omitted count. Missing measurements are null; unavailable parents are marked. CPU is sampled over approximately one second; 100% per process means one logical CPU. PSS divides shared pages between processes. Reports are saved in the system temporary directory ($TMPDIR, normally /tmp), named dot-snapshot-<timestamp>.md or .json. Existing output files are never overwritten.

**Options**

| Option | Description |
| --- | --- |
| `--sort` `<choice>` | Sort the process tree and JSON process list by CPU or memory (choices: cpu, mem) |
| `--limit` `<integer>` | Maximum visible tree processes, including parents, and entries per ranking table |
| `--min-memory-mib` `<number>` | Minimum measured subtree PSS in MiB for memory sorting (default: 80) |
| `--min-cpu` `<number>` | Minimum measured subtree CPU percentage for CPU sorting (default: 1; 100% = one core) |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot snapshot
dot snapshot --sort cpu
dot snapshot --limit 40
dot snapshot --min-memory-mib 50
```

## `dot firewall`

Reconcile managed ufw firewall rules

```text
dot firewall [flags]
```

Ensure the managed ufw allow rules are present with their exact source, destination, interface/direction, and purpose comment. Missing rules are added, stale-comment rules are deleted and re-added, then ufw is reloaded once. A source-restricted rule does not satisfy a managed any-source rule.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot firewall
```

## `dot doctor`

Run parallel health checks for dependencies, repositories, stow integrity, services, packages, browser configuration, hardware video, firewall rules, and OpenCode/Herdr integration. A timestamped report is always written under ~/.local/state/dot/logs/.

```text
dot doctor [flags]
```

Run health checks on the dotfiles system. All checks run in parallel and each section streams to the terminal as it finishes, followed by a grouped summary. A timestamped log is always written under ~/.local/state/dot/logs/.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Checks performed**

```text
Dependencies and configured gh extensions
Repositories, origin HEAD, git config, and stow integrity
OpenCode, Herdr, notifications, timers, and UWSM integration
Omarchy host links, browser flags/extensions, and hardware video
Public/private packages, pacman hooks, and managed firewall rules
```

**Exit codes**

```text
0  No critical errors (warnings may still be present)
1  One or more critical errors found
```

## `dot clean`

Unstow managed dotfiles

```text
dot clean [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

## `dot agent`

Agent harness tooling: instruction sync, linting and detection

```text
dot agent <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot agent sync`

Mirror AGENTS.md to agent harness instruction files

```text
dot agent sync [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot agent lint`

Run the repository's agent_lint commands from private dot-git.yml on changed files

```text
dot agent lint [flags] [<path...>]
```

Collect files changed in the working tree against HEAD, plus untracked files that are not ignored, and run the configured agent_lint commands in parallel from the repository root under dot run --timeout, reporting results in config order. Deleted files and submodule changes are left out. Paths narrow the changed files. --all uses every tracked and untracked file that is not ignored instead, so commands run without changes. --only runs just the named commands and reports only those. A run argument of exactly {files} expands to the changed files matching the command's include globs; commands without it run as they are, but only when a changed file matches. Each result is passed, failed, timed-out or skipped, with the last lines of output for failures. Exits non-zero when any command fails or times out. Repositories without agent_lint print a notice and exit zero.

**Options**

| Option | Description |
| --- | --- |
| `--json` | Print one JSON report instead of log lines |
| `--all` | Lint every file, not only changed ones |
| `--only` `<string>` | Run only the command with this name; repeatable |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<path>` | path |

**Examples**

```bash
dot agent lint
dot agent lint --json
dot agent lint src/one.ts src/two.ts --json
dot agent lint --all --only Typecheck --json
```

### `dot agent oxlint`

Run the advisory generic Oxlint pass on JavaScript and TypeScript changes in an opted-in repository. Repository-owned Oxlint takes precedence. Use --changed normally, explicit paths to lint whole files, or --all when explicitly requested. Pass --force to run despite those skips.

```text
dot agent oxlint [flags] [<path...>]
```

Run the generic @timmo001/oxlint-rules recommended config from a dot-managed cache without changing the target repository. The current repository must set agent_oxlint: true in private dot-git.yml. Repositories with their own Oxlint config, dependency, script, or local binary are skipped because their local setup takes precedence. Pass --force to run anyway. Diagnostics are advisory and do not make these personal rules authoritative for the host repository. --changed compares the working tree and untracked files with HEAD, prints only findings on added or modified lines, and exits non-zero when any remain. Paths with --changed limit that comparison to those files or directories. dot git commit runs the same check on the files it commits.

**Modes**

```text
--changed  Lint uncommitted changes, reporting only changed lines; add paths to narrow
<path>...  Lint explicit files or directories in full
--all      Lint the complete repository tree
--force    Run even if opt-in or repository Oxlint would skip
--opt-in   Enable and commit the existing config entry; add paths or --all to also lint
```

**Options**

| Option | Description |
| --- | --- |
| `--all` | Lint the complete repository tree |
| `--changed` | Lint uncommitted changes and report only findings on changed lines; paths narrow the scope |
| `--opt-in` | Enable the existing private config entry and commit the single-line change |
| `--force` | Run even if the repository is not opted in or already has Oxlint |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<path>` | path |

**Opt-in**

```text
--opt-in adds or sets only agent_oxlint: true in an existing private repository entry, preserving all other bytes. If the entry is missing, it offers the repo induct wizard with agent Oxlint prefilled as enabled. Without a terminal it prints induction instructions. The config must be tracked and clean. Active commit hooks are refused rather than bypassed so formatters cannot expand the change. Commits through dot git commit without pushing; unrelated staged files are excluded. An existing opt-in creates no commit.
```

**Examples**

```bash
dot agent oxlint --changed
dot agent oxlint --changed src/example.ts
dot agent oxlint src/example.ts
dot agent oxlint src/one.ts src/two.ts
dot agent oxlint --all
dot agent oxlint --force src/example.ts
dot agent oxlint --opt-in
```

### `dot agent detect`

Detect whether an AI coding agent is running dot

```text
dot agent detect [flags]
```

Detect whether dot is running under an agent harness from agent environment variables, falling back to a Linux /proc process-ancestry check. Exits 0 when an agent is detected and 1 otherwise, so scripts can branch with `if dot agent detect`. Set DOT_AGENT=1 to force detection on or DOT_AGENT=0 to force it off.

**Modes**

```text
(default)  Print the detected agent, or a no-agent message
--quiet    Print only the provider id (nothing when no agent)
--json     Print the detection result as JSON
```

**Options**

| Option | Description |
| --- | --- |
| `--quiet` `-q` |  |
| `--json` | Print JSON |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot agent detect
dot agent detect --quiet
dot agent detect --json
dot agent detect && echo running under an agent
```

### `dot agent permission`

Apply OpenCode permissions to other agent harnesses

```text
dot agent permission <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot agent permission hook`

Enforce OpenCode permission rules in Claude Code

```text
dot agent permission hook [flags]
```

Claude Code PreToolUse hook. Reads the hook event from stdin, maps the tool call onto OpenCode actions (shell, read, edit, external_directory, MCP server tools, webfetch, websearch, todowrite), and evaluates the permissions in ~/.config/opencode/opencode.json with OpenCode's semantics: the last matching rule wins and each part of a compound shell command is checked. Prints allow, ask or deny for Claude Code, or nothing when no rule decides so Claude Code's own prompting applies.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot agent permission hook < event.json
```

## `dot notes`

Integrate with the notes tool

```text
dot notes <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot notes capture`

Manage the notes capture Worker

```text
dot notes capture <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot notes capture sync`

Sync watched repositories to the notes capture picker

```text
dot notes capture sync [flags]
```

Regenerate the notes capture repository picker from repositories with GitHub notifications enabled in the private dot-git.yml configuration. Updates only CAPTURE_REPOSITORIES in the ignored capture/wrangler.local.jsonc file, creating it from the deploy template when needed. Mirrors non-secret settings from the active Worker, then deploys when the live picker differs.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot notes capture sync
```

## `dot setup`

Set up pacman package repositories

```text
dot setup <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot setup private`

Set up private package sources

```text
dot setup private <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot setup private repo`

Sync and register the private pacman repository

```text
dot setup private repo [flags]
```

Sync the private Arch package repo mirror, write the private pacman repo snippet, and add the Include line to /etc/pacman.conf when it is missing. This repairs Omarchy pacman.conf refreshes that remove local repository includes. Privileged writes prefer pkexec and fall back to sudo.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot setup private repo
```

### `dot setup public`

Set up public package sources

```text
dot setup public <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot setup public repo`

Trust and register the public timmo pacman repository

```text
dot setup public repo [flags]
```

Download the public signing key, require its pinned full fingerprint, locally sign it in pacman's keyring, and register the signed [timmo] repository before the other package repositories. The command fails before changing trust or pacman configuration when the repository is unavailable or the downloaded fingerprint does not match.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot setup public repo
```

## `dot git`

Work across tracked Git repositories

```text
dot git <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot git diff`

Show repository change state across all tracked repositories.

```text
dot git diff [flags]
```

**Modes**

```text
(default)       Text summary of repos with changes
--bar-json      JSON output for status bars
--panel-json    Full JSON panel snapshot
```

**Options**

| Option | Description |
| --- | --- |
| `--bar-json` | JSON output for status bars and shell modules |
| `--panel-json` | Full JSON snapshot for the native shell panel |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot git diff
dot git diff --bar-json
dot git diff --panel-json
```

### `dot git log`

Show recent commits across managed repositories

```text
dot git log <subcommand> [flags]
```

Lists the latest commits on each managed checkout's branch, including fetched upstream commits that are not pulled yet. Results are cached per repository and only re-read when HEAD or the upstream ref moves; --refresh re-reads everything.

**Options**

| Option | Description |
| --- | --- |
| `--refresh` | Re-read every repository, ignoring the cache |
| `--panel-json` | Return managed repositories and their recent commits as JSON |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot git log
dot git log --panel-json
dot git log show --path ~/repos/example --sha abc1234
dot git log show --path ~/repos/example --from def5678 --sha abc1234
dot git log show --path ~/repos/example --changes uncommitted
```

#### `dot git log show`

Return changed files and a diff preview as JSON for the Git panel, for one commit, a commit range or a repository's local changes

```text
dot git log show [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--path` `<string>` | Managed repository checkout path |
| `--sha` `<string>` | Full or abbreviated commit SHA |
| `--from` `<string>` | Show the net changes to --sha from this earlier commit, or from the empty tree with root |
| `--file` `<string>` | Repository-relative file to limit the result to; repeatable |
| `--changes` `<choice>` | Preview uncommitted changes including untracked files, commits not pushed upstream, or fetched commits not pulled yet (choices: uncommitted, unpushed, incoming) |
| `--help` `-h` | Show help information |

### `dot git web`

Open a Git web action using the repository's configured browser

```text
dot git web [flags]
```

Resolves repository browser settings from dot-git.yml, including linked worktrees. URL-only actions use the GitHub repository in the URL. Named browsers are argument lists under browsers; each repository can select one with browser. Without a selection, uses the desktop default. --work-time selects the work browser during work hours outside calendar leave, otherwise the desktop default. --browser overrides the selection. The Git panel uses --work-time for web actions and --browser work for Alt+Enter and Alt+click.

**Options**

| Option | Description |
| --- | --- |
| `--path` `<string>` | Repository directory; defaults to the current directory when no URL is supplied |
| `--url` `<string>` | Web URL; defaults to the repository's GitHub page |
| `--browser` `<string>` | Override the repository browser with a name from dot-git.yml |
| `--work-time` | Use the work browser during work time, otherwise the desktop default |
| `--actions` | Open the repository's GitHub Actions page |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot git web
dot git web --browser work
dot git web --url https://github.com/example/project/issues/1
```

### `dot git commit`

Commit staged changes through the guarded gateway. Subjects must be one line, have no trailing full stop, and stay within the hard length limit. Explicit --path scopes never imply git add -A; --amend keeps the existing message unless --message is supplied.

```text
dot git commit [flags]
```

Create a commit through dot's guarded gateway instead of raw git commit. The subject is validated as a single line with no trailing full stop and a length limit, then the staged set (or an explicit --path scope) is committed. It never runs git add -A.

Pass --amend to rewrite the previous commit instead of creating a new one; it keeps the existing message unless you pass --message. With --push, an amend force-pushes with --force-with-lease, never a plain force.

In repositories opted into agent Oxlint, the files being committed are linted and only findings on added or modified lines are reported. Warnings print and the commit continues; errors refuse the commit until they are fixed or --skip-agent-oxlint is passed. Agents are routed here by the dot-git-commit skill and blocked from raw git commit in the OpenCode permission config.

**Modes**

```text
(default)  Commit the staged set
--path     Commit only named files
--amend    Rewrite the previous commit
--dry-run  Preview the plan without changes
```

**Options**

| Option | Description |
| --- | --- |
| `--message` `-m` `<string>` | Single-line commit subject |
| `--path` `<path>` | Commit only this file; repeatable |
| `--amend` | Amend the previous commit |
| `--push` | Push after committing |
| `--dry-run` | Preview without changing anything |
| `--skip-agent-oxlint` | Commit despite agent Oxlint errors on changed lines |
| `--help` `-h` | Show help information |

**Message guards**

```text
Single line      Rejects multi-line messages
No em/en-dash    Rejects em/en-dashes; use a hyphen
No full stop     Rejects a trailing full stop
Warn over 60     Warns on stderr, still commits
Reject over 120  Fails; shorten the subject
```

**Base branch guard**

```text
Refuses commits to the base branch of a repo you do not own.
Owners you control are listed in git config dot.owner. Work on a feature branch.
For a maintained fork with an owned origin, opt in one exact branch with git config --local dot.maintainedForkBranch <branch>.
The exception requires owned origin fetch and push targets; global settings are ignored.
```

**Examples**

```bash
dot git commit -m "Add commit gateway"
dot git commit -m "Scope to one file" --path src/git/commands/Status.ts
dot git commit -m "Commit and push" --push
dot git commit --amend
dot git commit --amend -m "Reword the previous commit"
dot git commit -m "Preview only" --dry-run
```

### `dot git notifications`

Open the authenticated GitHub notification inbox. Without output, query or action flags, this opens the Omarchy shell panel. --all and --participating return filtered bar JSON.

```text
dot git notifications <subcommand> [flags]
```

**Modes**

```text
(default)       Open the shell notification panel
--bar-json      Status-bar JSON
```

**Options**

| Option | Description |
| --- | --- |
| `--bar-json` | JSON output for status bars and shell modules |
| `--all` | Include read notifications |
| `--participating` | Only participating threads |
| `--mark-read` `<string>` | Mark a thread as read |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot git notifications
dot git notifications --bar-json
dot git notifications --participating
dot git notifications dismiss --dry-run
dot git notifications --mark-read 12345
```

#### `dot git notifications dismiss`

Show a coloured repository summary, then review merged dependencies followed by remaining unread notifications. Done queues work in the background while progress appears above the next choices. Every repository offers Done, Open on GitHub, Skip and Stop. Stop ends the questions and finishes queued work before a completion and issues summary. --repo selects a single notification stack. Bar hiding preferences do not restrict this inbox.

```text
dot git notifications dismiss <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Configured repository name/path or GitHub owner/repository |
| `--dry-run` | Print repository batches and reasons without changing notifications |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot git notifications dismiss
dot git notifications dismiss --repo owner/repository
dot git notifications dismiss --dry-run
dot git notifications dismiss dependencies --mode all
dot git notifications dismiss remaining
```

#### `dot git notifications dismiss dependencies`

Review unread merged Renovate/Dependabot updates regardless of CI results. All-mode excludes unverifiable CI. Opening GitHub returns to the review without dismissing anything.

```text
dot git notifications dismiss dependencies [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Configured repository name/path or GitHub owner/repository |
| `--dry-run` | Print repository batches and reasons without changing notifications |
| `--mode` `<choice>` | Mark all verified dependencies done, or prompt per repository; omit to choose (choices: all, repos) |
| `--help` `-h` | Show help information |

#### `dot git notifications dismiss remaining`

Review all other unread notifications per repository, including PRs with unresolved CI and their reasons. This pass always requires a choice before dismissal.

```text
dot git notifications dismiss remaining [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Configured repository name/path or GitHub owner/repository |
| `--dry-run` | Print repository batches and reasons without changing notifications |
| `--help` `-h` | Show help information |

### `dot git releases`

Compare enabled repositories with their latest published stable release, explain impact and retain local reviews.

```text
dot git releases <subcommand> [flags]
```

Read the last local snapshot, collecting one on first use. --refresh fetches immutable release and branch refs immediately; --scheduled follows each repository's local-time cron and records attempted minutes. Draft and prerelease releases are excluded. Before the first stable release, the comparison covers the full history with the same quiet rules, and the first version is 0.1.0 (1.0.0 for a major impact), today's CalVer or the upstream fork base. Failed checks retain previous evidence marked stale. Quiet changes remain inspectable. Desktop notifications require --notify and honour configured minimum impact and cooldown. --open opens the release review, optionally selected by --repo, without fetching.

Local reviews require the displayed snapshot ID. Finding overrides follow exact evidence; an overall override follows the release-relevant comparison. Changed evidence invalidates its review. Use --impact auto to clear an override. Extra CI-only commits do not repeat delivery. Incomplete or stale evidence cannot be reviewed.

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Select an enabled repository by name or GitHub slug |
| `--scheduled` | Check only in a due cron minute, once per minute |
| `--refresh` | Fetch now, bypassing the schedule and cache |
| `--notify` | Send eligible desktop notifications with review actions |
| `--open` | Open the release review in the Omarchy shell |
| `--panel-json` | Complete JSON review snapshots, including quiet changes and errors |
| `--help` `-h` | Show help information |

**Policy**

```text
Optional releases config selects oxlint-rules or system-bridge and a watched branch.
Private overrides precede preset rules; the first match wins for each fact.
Match paths with globs, change_types, exact dependencies, roles, submodules or explicit subjects regexes.
Selectors are ANDed; values within each selector are ORed. Explicit path overrides match either rename endpoint.
Preset rename impact is the highest affected old/new boundary; both endpoints must be quiet for a quiet rename.
Subject selectors follow surviving source lines or individual structured values, excluding reverted intent.
Each net fact is classified once; any attributed subject can match the first applicable ordered rule.
Every override supplies impact (none/patch/minor/major) and a readable reason.
Dependency versions never imply consumer minor or major changes.
Notification enabled/minimum_impact/cooldown_minutes are stored for future explicit delivery.
```

**Examples**

```bash
dot git releases
dot git releases --refresh --panel-json
dot git releases --scheduled --notify --panel-json
dot git releases --open --repo example/project
dot git releases review --repo example/project --snapshot ID --finding FINDING --impact patch
dot git releases review --repo example/project --snapshot ID --finding ONE --finding TWO --impact none
dot git releases review --repo example/project --snapshot ID --impact auto
dot git releases publish --repo example/project --snapshot ID --notes-file notes.md
dot git releases publish --repo example/project --snapshot ID --notes-file notes.md --notes-mode replace --confirm PLAN
```

#### `dot git releases review`

Review exact local release evidence without publishing anything

```text
dot git releases review [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Configured repository name or GitHub slug |
| `--snapshot` `<string>` | Exact displayed snapshot ID; stale selections are rejected |
| `--panel-json` | Return the updated complete JSON snapshot |
| `--finding` `<string>` | Finding ID, or overall for the current release-relevant comparison (default); repeatable to set several findings at once |
| `--impact` `<choice>` | Local release impact; auto clears the override (choices: none, patch, minor, major, auto) |
| `--help` `-h` | Show help information |

#### `dot git releases publish`

Preview version changes, validation, pushes and release notes. --interactive explains and confirms in the terminal; --confirm PLAN executes a reviewed plan with live progress. --notes-file supplies hand-written notes.

```text
dot git releases publish [flags]
```

Requires an explicit private releases.publish recipe. The preview is read-only. Confirmation binds the reviewed snapshot, version files, commands and target. Preparation runs in an isolated worktree. Only agreed version changes, plus any releases.publish.generated_files the commands regenerate (such as a lockfile), are committed through dot git commit, then the version commit and tag are pushed atomically. GitHub release notes are generated from the previous stable release (or the full history for a first release), unless --notes-file supplies hand-written notes. The file must exist and not be empty; its text is shown in the preview and bound to the plan, so pass the same --notes-file on confirmation and an edited file needs a new preview. --notes-mode prepend (default) puts the file before the generated notes, editing the release straight after creation; replace uses only the file. Progress includes command output and a saved log. Release creation does not wait for GitHub publication jobs; follow the returned Actions URL. Failed preparation is retained for inspection. Refresh and preview again after resolving a failure.

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Configured repository name or GitHub slug |
| `--snapshot` `<string>` | Exact displayed snapshot ID; stale selections are rejected |
| `--panel-json` | Stream JSON progress and the final plan or release result |
| `--interactive` | Explain, confirm and run the release in this terminal, with an optional log pager |
| `--confirm` `<string>` | Execute the exact plan ID returned by the preview |
| `--notes-file` `<string>` | Markdown file with hand-written release notes, read at preview and again at confirmation |
| `--notes-mode` `<choice>` | Put --notes-file before the generated notes (prepend, default) or use it alone (replace) (choices: prepend, replace) |
| `--help` `-h` | Show help information |

### `dot git issues`

Track open issues for enabled repositories, independently of GitHub notifications

```text
dot git issues [flags]
```

Opt in with issues.enabled in private dot-git.yml. Open issues exclude pull requests and are ordered by latest update. Rules under the top-level issues.exclude list hide matching issues, such as a Dependency Dashboard; each rule matches when every field it sets (title, author, label and optional repo) matches, case-insensitively. Queries fetch at most every five minutes unless --refresh is supplied. Failed fetches retain the last successful list and report an error.

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Select an enabled repository by name or GitHub slug |
| `--refresh` | Fetch now instead of using the five-minute cache |
| `--open` | Open the tracked issue page in the Git panel |
| `--panel-json` | Return enabled repositories and their open issues as JSON |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot git issues --panel-json
dot git issues --refresh
dot git issues --open
```

## `dot mcp`

Manage agent MCP server configs

```text
dot mcp <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot mcp sync`

Regenerate MCP configs for all harnesses from the spec

```text
dot mcp sync [flags]
```

Regenerate each active harness's native MCP config from the private spec (mcp.yml). Repository opencode_mcp lists in dot-git.yml opt into named servers using generated, Git-ignored .opencode/opencode.jsonc files; removing an opt-in removes its generated config. Existing unowned or tracked configs are preserved and reported as conflicts. Global configs are written into the stowed private source tree; run dot stow after. Claude Code's user scope is updated through the claude CLI instead of a file. Some agent harnesses are documented stubs and are not written.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot mcp sync
```

## `dot private`

Work with the private package repository

```text
dot private <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot private pkg`

Manage private packages

```text
dot private pkg <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot private pkg publish`

Build and publish a private package

```text
dot private pkg publish [flags] <package-name>
```

Build and publish a mapped private package into the private pacman repo.

**Options**

| Option | Description |
| --- | --- |
| `--no-git` | Skip package repo commit and push |
| `--skip-build` | Publish an existing artifact |
| `--install` | Install after publishing |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<package-name>` | Mapped private package name |

**Examples**

```bash
dot private pkg publish my-package --install
dot private pkg publish --skip-build --no-git my-package
```

## `dot skills`

Maintain imported agent skills

```text
dot skills <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot skills validate`

Validate the standalone skills repository

```text
dot skills validate [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot skills import`

Import or refresh a reviewed skill snapshot

```text
dot skills import [flags] <name>
```

**Options**

| Option | Description |
| --- | --- |
| `--apply` | Apply a clean imported snapshot |
| `--metadata-only` | Materialise metadata only |
| `--reviewed-sha` `<string>` | Set the reviewed upstream SHA |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<name>` | Imported skill name |

### `dot skills updates`

Check/apply imported skill updates

```text
dot skills updates <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--check` | Check only |
| `--update` | Apply clean updates |
| `--json` | Report as JSON |
| `--skill` `<string>` | Limit to one skill |
| `--no-commit` | Apply without committing |
| `--skip-review` | Skip local-edit review |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot skills updates --json
dot skills updates --update --skill agentic-workflows --no-commit
```

#### `dot skills updates agent`

Run skill update automation

```text
dot skills updates agent <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot skills updates agent github`

Run GitHub skill update automation

```text
dot skills updates agent github [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--skills-dir` `<path>` | Use this Skills checkout |
| `--help` `-h` | Show help information |

#### `dot skills updates agent device`

Run local device skill update automation

```text
dot skills updates agent device [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--config` `<path>` | Use this YAML config |
| `--run-id` `<string>` | Wait for this workflow run |
| `--help` `-h` | Show help information |

### `dot skills check`

Check adapted imports against upstream

```text
dot skills check [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--open-opencode` | Attempt OpenCode analysis |
| `--diff-origin` | Diff against upstream origins |
| `--skill` `<string>` | Check one skill |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot skills check --skill agentic-workflows
```

### `dot skills consumers`

Manage repositories that receive shared skill copies

```text
dot skills consumers <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot skills consumers add`

Share skills with a repository through consumers.yml, push the change and install them there straight away

```text
dot skills consumers add [flags] <skill...>
```

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | owner/name of the consumer repository (default: the current directory's GitHub repository) |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<skill>` | Skills to share with the repository |

**Examples**

```bash
dot skills consumers add code-review testing
dot skills consumers add --repo timmo001/ha-bridge writing-style
```

#### `dot skills consumers remove`

Stop sharing skills with a repository through consumers.yml, push the change and remove the copies there straight away. Dropping the last skill, or --all, also drops its entry.

```text
dot skills consumers remove [flags] [<skill...>]
```

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | owner/name of the consumer repository (default: the current directory's GitHub repository) |
| `--all` | Stop sharing every skill, remove the copies now and drop the repository |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<skill>` | Skills to stop sharing with the repository |

**Examples**

```bash
dot skills consumers remove writing-style
dot skills consumers remove --repo timmo001/ha-bridge --all
```

## `dot completions`

Generate shell completions

```text
dot completions [flags] [<shell>]
```

Generate the managed dot and skill-maintenance completion files for the selected shell so the next dot stow installs them.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<shell>` | Shell to generate completions for |

**Examples**

```bash
dot completions zsh
dot completions bash
dot completions fish
```

## `dot repo`

List and induct tracked repositories in private dot-git.yml

```text
dot repo <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot repo list`

List tracked repositories and shortcuts from private dot-git.yml

```text
dot repo list [flags] [<query>]
```

Read-only lookup of the repositories and path shortcuts configured in private dot-git.yml, the same list behind the prefix+s picker and repository shortcuts. Reads the config directly, so it does not depend on the generated picker cache. Each entry reports name, path, github (null for shortcuts), aliases, kind, whether the checkout exists and whether it is the deepest tracked path containing the working directory. Each entry also reports herdr: live state from the shared Herdr server (HERDR_SOCKET_PATH or the default socket), with open, the workspaces labelled with the repository name or inside its worktrees (id, label, focused, tabCount, paneCount, agentStatus, checkoutPath, linkedWorktree), and the agents running in them (name, agent, status, workspaceId, paneId, focused, cwd). herdr is null when the server cannot be reached; agent status is a snapshot. A query matches name, aliases, GitHub slug or repository name, and path, case-insensitively, with exact matches first. --open keeps only repositories with an open Herdr workspace, and fails when the Herdr server cannot be reached. Prints JSON with --json or when run under an AI agent, otherwise an aligned table. Exits 1 when a query matches nothing, and fails when private config is unavailable or invalid.

**Options**

| Option | Description |
| --- | --- |
| `--open` | Only list repositories open in Herdr |
| `--json` | Print JSON (the default under an AI agent) |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<query>` | Filter by name, alias, GitHub slug or path (exact matches first) |

**Examples**

```bash
dot repo list
dot repo list notes
dot repo list arch-repo --json
dot repo list --open --json
```

### `dot repo search`

Fuzzy-search tracked repositories and shortcuts

```text
dot repo search [flags] <query...>
```

Ranks tracked repositories from private dot-git.yml by fuzzy match on name, aliases, GitHub repository name, GitHub slug, directory name and path (path matches count for less). Each whitespace-separated term must match some field, with typo and partial-word tolerance loose enough for ambiguous queries, though a term found only inside other words (her in weather) scores lower; matches under 40 or more than 20 points below the best are dropped. Returns the top 5 by default; use --limit to change that or --all for every close match, such as a whole group of repositories. Results carry the same fields as dot repo list, including herdr, plus score (1 to 100) and matched (the fields that matched), highest score first. JSON is { results, hint }, where hint says how many more matches --limit or --all would show and is omitted when there are none; the table ends with the same hint. Prints JSON with --json or when run under an AI agent, otherwise an aligned table. Exits 1 when nothing matches.

**Options**

| Option | Description |
| --- | --- |
| `--limit` `<integer>` | Maximum results (default: 5) |
| `--all` | Return every close match instead of the top 5 |
| `--json` | Print JSON (the default under an AI agent) |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<query>` | Fuzzy terms matched against name, aliases, GitHub repository name and slug, directory and path |

**Examples**

```bash
dot repo search pacman
dot repo search omarchy clock
dot repo search notse --limit 3 --json
dot repo search ha --all
```

### `dot repo induct`

Induct a local repository into private dot git config with a preview before committing

```text
dot repo induct [flags] [<path>]
```

The terminal wizard asks for Normal (first and default) or Home Assistant, then every repository field using private dot-git-presets.yml defaults and local Git identity, including an optional release watching template from its release_templates. Flags prefill the wizard. With --noninteractive, flags override preset defaults and the command only previews; repeat the reviewed options with --commit to save. Each run validates the complete config and shows the exact diff. The config must be tracked and clean; active commit hooks are refused. Existing entries and formatting are preserved. Commits through dot git commit without pushing or including unrelated staged files. Repositories already inducted are rejected; use dot agent oxlint --opt-in to enable their agent pass.

**Options**

| Option | Description |
| --- | --- |
| `--preset` `<choice>` | Private preset (default: normal) (choices: normal, home-assistant) |
| `--name` `<string>` | Friendly repository label |
| `--github` `<string>` | GitHub owner/repository (default: origin remote) |
| `--aliases` `<string>` | Space- or comma-separated aliases; empty for none |
| `--post-update` `<string>` | Post-update command; empty for none |
| `--agent-oxlint` | Enable agent Oxlint; --no-agent-oxlint disables it |
| `--activity-enabled` | Enable activity checks; --no-activity-enabled disables them |
| `--activity-schedule` `<string>` | Activity schedule: five-field cron or work |
| `--notifications-enabled` | Enable notifications; --no-notifications-enabled disables them |
| `--notifications-schedule` `<string>` | Notification schedule: five-field cron or work |
| `--ignore-bot-activity` | Filter bot-only activity; --no-ignore-bot-activity shows it |
| `--pull-requests` | Show open pull requests in the Git panel; --no-pull-requests hides them |
| `--issues` | Show open issues in the Git panel; --no-issues hides them (default: the preset, for repositories you own with GitHub issues enabled) |
| `--browser` `<string>` | Named browser from dot-git.yml; empty for the desktop default |
| `--herdr-after` `<string>` | Herdr workspace to open after; empty for none (default: last entry with the preset prefix) |
| `--notes-remote` `<string>` | Git remote for notes; empty for none (default: upstream when present) |
| `--agent-lint` `<string>` | Agent lint command, split on spaces; empty for none |
| `--opencode-mcp` `<string>` | Space- or comma-separated OpenCode MCP servers; empty for none |
| `--release-template` `<string>` | Private release template name from dot-git-presets.yml, or none |
| `--release-branch` `<string>` | Branch compared with the published release (default: the template's branch, then origin's default branch) |
| `--noninteractive` | Use flags and preset defaults without questions; preview by default |
| `--commit` | Commit the proposed entry with --noninteractive after reviewing its preview |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<path>` | path |

**Examples**

```bash
dot repo induct
dot repo induct ~/repos/example --noninteractive --preset normal --name Example --aliases example
dot repo induct ~/repos/example --noninteractive --preset normal --name Example --aliases example --commit
```

## `dot pr`

Watch, list, read reviews on and queue pull requests

```text
dot pr <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot pr watch`

Watch pull request runs, checks and reviews, streaming progress and a full report

```text
dot pr watch [flags] [<pr...>]
```

Follow every GitHub Actions run on each pull request's head commit, including Copilot code review runs, plus external status checks. Superseded runs of the same workflow on the same commit are ignored, and a new push moves the watch to the new head. Progress streams to stdout one line per event; failed job logs and the final review dump go to a Markdown report whose path is printed first and last. Failed jobs are reported as soon as they finish, even while the rest of the run continues. The watch ends after two settled polls, waiting up to five more minutes for requested bot reviews. The review dump lists reviews newest first, unresolved threads with every comment in full, and resolved or minimized threads with only their replies. The command never changes the pull request. Designed for OpenCode 2 background shells: the completion notification carries the short summary and the report holds the detail.

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Repository slug when the PRs are elsewhere |
| `--stop-on` `<choice>` | Stop early on a failed job or check, or a new review with open threads; repeatable (choices: failure, review) |
| `--timeout` `<string>` | Overall watch deadline (default: 60 minutes) |
| `--interval` `<integer>` | Seconds between polls |
| `--log-lines` `<integer>` | Trailing failed-log lines kept per job; 0 keeps everything |
| `--output` `<path>` | Report path (default: ~/.local/state/dot/pr-watch/<repo>-<prs>-<time>.md) |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<pr>` | Pull request numbers (default: the current branch's pull request) |

**Exit codes**

```text
0    Everything finished and passed
1    A job or check failed, or the watch could not start
3    Stopped early by --stop-on while other work was still pending
124  Timed out
```

**Examples**

```bash
dot pr watch
dot pr watch --stop-on failure
dot pr watch 54322 54325 54328 --repo home-assistant/frontend
```

### `dot pr reviews`

Print a pull request's reviews and review threads once

```text
dot pr reviews [flags] [<pr...>]
```

Fetch each pull request's latest reviews, every review thread with its comments, and bot reviews still requested, then exit. Markdown matches the review dump in dot pr watch reports: reviews newest first, unresolved threads with every comment in full, and resolved or minimized threads with only their replies. --json prints { pullRequests } with number, title, url, owner, name, repo, head, openThreads, botRequests, reviews and threads for each pull request. Read-only; exits 1 when a pull request cannot be resolved or fetched.

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Repository slug when the PRs are elsewhere |
| `--json` | Print the review state as JSON instead of Markdown |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<pr>` | Pull request numbers (default: the current branch's pull request) |

**Examples**

```bash
dot pr reviews
dot pr reviews --json
dot pr reviews 54322 54325 --repo home-assistant/frontend
```

### `dot pr queue`

List reviewable pull requests and what was opened, merged or closed recently

```text
dot pr queue [flags]
```

Run the repository's review_search from private dot-git.yml (or --search) and classify each pull request deterministically: size from changed lines, failing and pending checks, latest reviews, review decision, unresolved review threads by author, labels, comment count and first-time contributors. --reviewable searches beyond the saved filter, includes PR descriptions, recent comments and thread text, and leaves judgement of those comments to the reviewer. --threads adds each unresolved thread's comments for the saved search. Effort groups are small (up to 150 changed lines), medium (up to 400) and large; a failing check or requested changes makes a pull request not ready. The activity window lists every pull request merged, closed without merging or opened since --since, newest first, with size and labels, plus the net change in open pull requests. Read-only.

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Repository slug (default: the current checkout) |
| `--search` `<string>` | Pull request search overriding review_search from private dot-git.yml |
| `--reviewable` | Search open non-draft PRs beyond the saved review search and include descriptions, review and PR comment text |
| `--since` `<string>` | Activity window start: today, yesterday, YYYY-MM-DD (local midnight), an ISO timestamp, or an age such as 12h, 3d or 1w |
| `--sort` `<choice>` | Queue order: effort groups (small, medium, large, not ready), or one table by updated, created or size (choices: effort, updated, created, size) |
| `--only` `<choice>` | Print only the review queue or only the activity window (choices: queue, activity) |
| `--limit` `<integer>` | Maximum queue pull requests |
| `--json` | Print JSON instead of Markdown |
| `--threads` | Include the comments of unresolved review threads for queue pull requests |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot pr queue
dot pr queue --only queue --reviewable --json
dot pr queue --only activity --since 2026-09-19
dot pr queue --sort updated --since 3d --json
```

### `dot pr list`

Track open pull requests for enabled repositories, independently of GitHub notifications

```text
dot pr list [flags]
```

Opt in with pull_requests.enabled in private dot-git.yml. Open PRs include drafts and automation, ordered by latest update. Use --repo <repository> --ignore <number> to hide a PR locally from the panel and all PR counters. Successful refreshes remove ignored entries once they close, merge or disappear. A non-draft PR is ready when at least one CI check passes and none fail, remain pending or are cancelled; failed check names are shown in the panel. Queries fetch at most every five minutes unless --refresh is supplied. Failed fetches retain the last successful list and ignore entries, and report an error.

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Select an enabled repository by name or GitHub slug |
| `--refresh` | Fetch now instead of using the five-minute cache |
| `--open` | Open the tracked pull request page in the Git panel |
| `--ignore` `<integer>` | Hide a PR locally from the panel and counters; requires --repo |
| `--panel-json` | Return enabled repositories and their open pull requests as JSON |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot pr list --panel-json
dot pr list --refresh
dot pr list --open
```

## `dot launch`

Launch desktop apps

```text
dot launch <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot launch floating`

Launch floating windows

```text
dot launch floating <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot launch floating webapp`

Launch one Omarchy webapp and place its new window in the target monitor's bottom-right corner, or reposition an existing window with --address. Width and height must be positive integers; margins must be non-negative.

```text
dot launch floating webapp [flags] [<url>]
```

**Options**

| Option | Description |
| --- | --- |
| `--monitor` `<string>` | Target monitor |
| `--workspace` `<string>` | Target workspace |
| `--width` `<integer>` | Window width |
| `--height` `<integer>` | Window height |
| `--right-margin` `<integer>` | Right margin |
| `--bottom-margin` `<integer>` | Bottom margin |
| `--address` `<string>` | Existing window address |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<url>` | Webapp URL to launch |

**Exit codes**

```text
0  Window placed and its address printed
1  Launch detection, Hyprland query, or placement failed
2  Invalid arguments
```

## `dot herdr`

Manage the shared Herdr server and repository workspaces

```text
dot herdr <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot herdr start`

Start the default Herdr server with the desktop autostart launch context

```text
dot herdr start [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot herdr stop`

Stop the default Herdr server only when its panes are idle shells. Run outside Herdr; --check also works inside it. Lists active agents, commands, and background jobs, then exits if blocked.

```text
dot herdr stop [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--check` | Report blockers without stopping |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot herdr stop --check
dot herdr stop
```

### `dot herdr restart`

Restart the default Herdr server only when its panes are idle shells. Run outside Herdr; --check also works inside it. Lists active agents, commands, and background jobs, then exits if blocked.

```text
dot herdr restart [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--check` | Report blockers without restarting |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot herdr restart --check
dot herdr restart
```

### `dot herdr repo`

Open repository workspaces

```text
dot herdr repo <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot herdr repo open`

Open or focus a repository workspace in the shared Herdr session, attaching a tiled terminal when needed. Commands reuse an idle shell pane by default, checking the focused pane, other panes in its tab, then other tabs before splitting right. --layout vertical always splits right, horizontal splits below, and tab always opens a new tab. --modifiers selects the same behaviour from Qt click/Enter modifiers, with Ctrl taking priority over Alt, then Shift. Placement flags are mutually exclusive. Use --agent to resolve the launcher, label and kind from dot herdr agents; it cannot be combined with a command or --agent-kind. With --agent opencode2, --model creates an OpenCode session on a uniquely matched model before launching the full TUI and sending any prompt. Agent launches wait for readiness and verify the selected kind before naming or prompting. --prompt-file reads the prompt from a file before anything is launched and cannot be combined with --prompt. --no-focus leaves the current view alone. --after-prefix places a newly created workspace after the last workspace whose label starts with the prefix, keeping related workspaces together. Without it, a new workspace whose label starts with a [tag] joins that tag's group, and one whose label extends an existing one by a whole word (Dotfiles Private after Dotfiles) joins that group. A herdr_after label in dot-git.yml takes priority: the workspace opens straight after the nearest open workspace in its herdr_after chain, or straight before the first open workspace that chains back to it. --json reports resource IDs, creation flags, agent details, model and whether the prompt was sent. Without a command or --agent, focus the workspace; an empty command opens a shell using the selected layout.

```text
dot herdr repo open [flags] <label> <directory> [<tab-label>] [<command>]
```

**Options**

| Option | Description |
| --- | --- |
| `--layout` `<choice>` | Auto reuses an idle shell pane, otherwise splits right; vertical splits right, horizontal splits below, tab opens a new tab (choices: auto, vertical, horizontal, tab) |
| `--modifiers` `<integer>` | Qt keyboard modifier bitmask: Ctrl new tab, Alt split below, Shift split right, otherwise auto |
| `--prompt` `<string>` | Initial prompt to send through Herdr after the agent is ready |
| `--prompt-file` `<string>` | Read the initial prompt from a file; use for multi-line or shell-sensitive briefs; cannot be combined with --prompt |
| `--agent-kind` `<string>` | Expected Herdr agent kind for an explicit command |
| `--agent` `<string>` | Installed launcher from dot herdr agents, such as opencode2 |
| `--model` `<string>` | OpenCode 2 model or unique name match, optionally with #variant; requires --agent opencode2 |
| `--variant` `<string>` | Model variant such as low; requires --model and cannot be combined with #variant |
| `--agent-name` `<string>` | Unique Herdr agent name, assigned before prompting |
| `--after-prefix` `<string>` | Place a newly created workspace after the last workspace whose label starts with this prefix |
| `--no-focus` | Keep the current view focused without opening a terminal client |
| `--json` | Print resource IDs, creation flags, agent details and prompt status as JSON |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<label>` | Herdr workspace label |
| `<directory>` | Repository working directory |
| `<tab-label>` | Optional command tab label; defaults to the selected agent label or Shell |
| `<command>` | Optional command to run |

**Exit codes**

```text
0  Repository workspace focused or opened
1  Herdr operation failed
2  Invalid arguments
```

### `dot herdr model`

Switch the model and variant of an existing Herdr OpenCode 2 agent. Validates the model with opencode2 models and any #variant or --variant against the project's model catalogue before updating the session through the API. Omitting the variant selects the model's default settings. Does not send a prompt or interrupt a request already in progress.

```text
dot herdr model [flags] <target> <model>
```

**Options**

| Option | Description |
| --- | --- |
| `--variant` `<string>` | Model variant such as low; cannot be combined with #variant |
| `--json` | Print the session ID and selected model as JSON |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<target>` | Herdr agent name or pane ID |
| `<model>` | OpenCode 2 model or unique name match, optionally with #variant |

### `dot herdr pane`

Move panes between tabs

```text
dot herdr pane <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot herdr pane move`

Move a pane into another tab, beside a chosen pane

```text
dot herdr pane move [flags] [<pane>]
```

Moves the focused pane, or a pane ID or live agent name, into another tab or out into a new tab. On a terminal, anything the flags leave open is asked for: which pane when its tab has several, the destination tab (filterable across every workspace, current workspace first, each listing its panes and agents), which pane to split beside when the destination has several, and the split direction, offering first the one that suits that pane's shape. Without a terminal, or with --json, the focused panes are used, --split defaults to auto and --to is required. Moving into another workspace gives the pane a new ID, which the output reports; agent names follow the pane.

**Options**

| Option | Description |
| --- | --- |
| `--to` `<string>` | Destination tab ID, tab number in the pane's workspace, tab label, or new |
| `--target` `<string>` | Pane ID or agent name in the destination tab to split beside |
| `--split` `<choice>` | Split direction; auto picks right for wide panes and down for tall ones (choices: auto, right, down) |
| `--no-focus` | Leave focus where it is |
| `--json` | Print the moved pane, tab and split as JSON |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<pane>` | Pane ID or agent name to move (default: the focused pane) |

**Examples**

```bash
dot herdr pane move
dot herdr pane move reviewer --to 2 --split auto
dot herdr pane move --to new
```

### `dot herdr context`

Show context for a locally attached Herdr terminal

```text
dot herdr context [flags]
```

Shows the selected workspace, tab, pane, directory and Git repository while a local foreground terminal client is connected to the selected Herdr session. Desktop window focus is not required. JSON uses attached: false and null context fields when no terminal is attached. Without --session, uses the SDK's HERDR_SOCKET_PATH, HERDR_SESSION and default socket selection. Local Linux process and socket checks do not detect remote clients. Probe failures exit non-zero with an error on stderr. --watch emits changed context as newline-delimited JSON, following workspace, tab and pane events with a 30-second fallback. Send refresh followed by a newline on stdin to collect and emit context even when unchanged. Watch failures emit null and an error on stderr; dropped connections reconnect automatically.

**Options**

| Option | Description |
| --- | --- |
| `--json` | Emit attached-session context as JSON |
| `--watch` | Watch context changes as newline-delimited JSON |
| `--session` `<string>` | Select a Herdr session (use default for the default socket) |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot herdr context
dot herdr context --json
dot herdr context --watch --json
dot herdr context --session default
```

### `dot herdr agents`

List installed agent targets shared by repository and release pickers

```text
dot herdr agents [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

## `dot homeassistant`

Aliases: `dot ha`

Run Home Assistant Core and frontend dev servers

```text
dot homeassistant <subcommand> [flags]
```

Runs the pitchfork daemons and frontend suites behind the Home Assistant dev setup, configured in $XDG_CONFIG_HOME/dot/homeassistant.yml. Interactive runs go through dot status run and, under Herdr, open in the repository's workspace. Under an agent, commands skip setup, Herdr and prompts: they reuse a running daemon and fail with a message instead of stopping a conflicting one.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot ha c dev
dot ha f serve prod
dot ha status
```

### `dot homeassistant core`

Aliases: `dot homeassistant c`

Run Home Assistant Core

```text
dot homeassistant core <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot homeassistant core dev`

Run Core serving the local frontend build

```text
dot homeassistant core dev [flags]
```

Runs setup, then starts the Core pitchfork daemon, which starts the frontend build it depends on. Stops the frontend serve daemon first after asking. Under an agent, it skips setup, Herdr and prompts, and only starts the daemon when nothing conflicts.

**Options**

| Option | Description |
| --- | --- |
| `--latest` | Rebase dev onto upstream/dev and push it during setup |
| `--background` | Return once it is ready, leaving it running |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot homeassistant core dev
dot ha c dev --latest --background
```

#### `dot homeassistant core setup`

Update Core's dev branch and bootstrap its virtual environment

```text
dot homeassistant core setup [flags]
```

On a clean tree, switches to dev, pulls it and fetches upstream/dev; --latest also rebases onto upstream/dev and pushes. Then creates the virtual environment if needed and runs script/bootstrap. Refuses to run under an agent.

**Options**

| Option | Description |
| --- | --- |
| `--latest` | Rebase dev onto upstream/dev and push it after pulling |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot homeassistant core setup --latest
```

### `dot homeassistant frontend`

Aliases: `dot homeassistant f`

Run Home Assistant frontend builds and dev servers

```text
dot homeassistant frontend <subcommand> [flags]
```

Every command here takes the frontend's build lock, so each stops the frontend pitchfork daemons first after asking. Lint, format, type checks and unit tests don't take the lock; run them with pnpm directly.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot homeassistant frontend dev`

Run the frontend watch build that Core serves

```text
dot homeassistant frontend dev [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--background` | Return once it is ready, leaving it running |
| `--attach` | Follow an already running build instead of asking to restart it |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot homeassistant frontend dev
dot ha f dev --background
```

#### `dot homeassistant frontend serve`

Run the frontend dev server against another Core

```text
dot homeassistant frontend serve [flags] [<target>]
```

Writes the Core URL for the serve daemon, starts the target's own daemon when it has one, then starts the serve daemon. Stops the frontend build daemon first after asking.

**Options**

| Option | Description |
| --- | --- |
| `--background` | Return once it is ready, leaving it running |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<target>` | Serve target from homeassistant.yml, or a Core URL |

**Examples**

```bash
dot ha f serve prod
dot ha f serve https://core.example.com --background
```

#### `dot homeassistant frontend build`

Run the frontend production build

```text
dot homeassistant frontend build [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot ha f build
```

#### `dot homeassistant frontend gallery`

Run the frontend gallery dev server

```text
dot homeassistant frontend gallery [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--background` | Return once it is ready, leaving it running |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot ha f gallery --background
```

#### `dot homeassistant frontend demo`

Run the frontend demo dev server

```text
dot homeassistant frontend demo [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--background` | Return once it is ready, leaving it running |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot ha f demo --background
```

#### `dot homeassistant frontend e2e`

Run the frontend e2e app dev server

```text
dot homeassistant frontend e2e [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--background` | Return once it is ready, leaving it running |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot ha f e2e --background
```

#### `dot homeassistant frontend test`

Run frontend tests

```text
dot homeassistant frontend test <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot homeassistant frontend test e2e`

Run the frontend e2e tests

```text
dot homeassistant frontend test e2e [flags] [<suite>]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<suite>` | Suite to test (default: all) |

**Examples**

```bash
dot ha f test e2e
dot ha f test e2e app
```

### `dot homeassistant dev`

Run Core and the frontend build in their Herdr workspaces

```text
dot homeassistant dev [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--background` | Return once it is ready, leaving it running |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot ha dev
dot ha dev --background
```

### `dot homeassistant status`

Show the Home Assistant dev servers

```text
dot homeassistant status [flags] [<target...>]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<target>` | core, build, serve, a serve target with a daemon, gallery, demo or e2e (default: all) |

**Examples**

```bash
dot ha status
dot ha status core serve
```

### `dot homeassistant stop`

Stop Home Assistant dev servers

```text
dot homeassistant stop [flags] [<target...>]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<target>` | core, build, serve, a serve target with a daemon, gallery, demo or e2e (default: all) |

**Examples**

```bash
dot ha stop
dot ha stop gallery
```

### `dot homeassistant logs`

Print or follow a Home Assistant dev server's logs

```text
dot homeassistant logs [flags] <target>
```

**Options**

| Option | Description |
| --- | --- |
| `--follow` | Follow the logs |
| `--lines` `<integer>` | Recent lines to print |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<target>` | core, build, serve, a serve target with a daemon, gallery, demo or e2e |

**Examples**

```bash
dot ha logs core
dot ha logs serve --follow
```

## `dot reload`

Reload the desktop shell and services, or selected parts

```text
dot reload [flags] [<part...>]
```

Reload parts of the desktop that can go stale after suspend or a change. With no parts, reloads everything. keyboard re-arms the keyboard backlight. upnext rechecks Up Next sources, restarting its service if the recheck fails; it runs alongside the other parts because the YouTube check takes several seconds. shell clears a workspace mutation lock left by a dot workspace command stuck on a shell menu, regenerates shell.json, restarts the Omarchy shell, rescans plugins and refreshes shell modules. updates refreshes available updates. doctor starts the dot doctor check.

**Options**

| Option | Description |
| --- | --- |
| `--no-auto-open` | Do not open auto-open live channels during the upnext recheck |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<part>` | Parts to reload (default: all) |

**Examples**

```bash
dot reload
dot reload --no-auto-open
dot reload shell
dot reload shell updates
```

## `dot workspace`

Set up and lay out desktop workspaces

```text
dot workspace <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

### `dot workspace setup`

Launch or reuse desktop apps and rebuild the workspace layout

```text
dot workspace setup [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--sleep` `<number>` | Wait before running setup logic |
| `--mode` `<choice>` | Use the work or normal layout instead of detecting work time (choices: work, normal) |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot workspace setup
dot workspace setup --mode=work
dot workspace setup --mode=normal
```

### `dot workspace relayout`

Apply or capture a Hyprland workspace layout

```text
dot workspace relayout [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--edit` | Capture or overwrite a preset |
| `--help` `-h` | Show help information |

## `dot help`

Show this help menu

```text
dot help [flags] [<command...>]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<command>` | Command path to show help for |

**Examples**

```bash
dot help
dot help git commit
```
