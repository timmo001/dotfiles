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

Self-update, pull repos, stow dotfiles, rebuild. Phase flags are inclusive: passing any of --pull, --stow, or --app runs only the selected phases. Internal --no-self-update and --post-hook-repo flags support the active self-update handoff.

```text
dot update [flags]
```

A full update pulls the public dotfiles, installs Bun dependencies, rebuilds and relaunches dot, then scans and pulls tracked repositories, trusting mise configs only in repositories it freshly clones. Pulls are fast-forward-only and never stash or rebase: Git refuses an update if local edits would be overwritten or histories have diverged. It regenerates completions, installs missing public Arch/AUR packages, runs the required MCP sync, stows, rebuilds again, runs agents sync, backfills the init marker, and starts the resume refresh. It finishes with a summary of updated repositories and completed actions.

Phase flags are inclusive: passing any of --pull, --stow, or --app runs only the selected phases. Scoped runs skip full-update package reconciliation, agents sync, and init-marker backfill.

Use --repo PATH (repeatable) to pull selected repositories, restore their pinned submodules and run configured post-update commands after HEAD changes. Changed public or private dotfiles also rebuild, stow and sync agent instructions once per batch. Add --pull to only pull and run post-update commands, skipping the dotfiles rebuild and stow. Herdr plugins are refreshed only inside Herdr. The Git panel uses --no-reload to skip shell reload and UI resume refresh.

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
| `--no-reload` | Skip shell reload and UI resume refresh |
| `--post-hook-repo` `<string>` | Internal post-hook repository |
| `--help` `-h` | Show help information |

**Exit codes**

```text
0   Update completed, or no actionable updates were found
1   Fatal workflow failure
2   Update check could not finish
10  Update check found pulls, pending pins or stow changes
11  Legacy Hypr migration is required
```

## `dot system-update`

Select and run Dotfiles, Omarchy, and Topgrade updates

```text
dot system-update [flags]
```

Select maintenance steps interactively, then run them in order: Dotfiles, Omarchy, and Topgrade. Interactive runs pre-select Dotfiles and Omarchy; extra Topgrade steps start unselected. Non-interactive runs and --yes select every step. Cancelling the prompt exits without running updates.

**Options**

| Option | Description |
| --- | --- |
| `--yes` | Select every update without prompting |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot system-update
dot system-update --yes
```

## `dot deps`

Validate and publish grouped native dependency updates

```text
dot deps <subcommand> [flags] [<repository>]
```

Read native policy and manifests from a pinned remote target, preserving the caller's checkout. Exclude whole groups covered by any open dependency PR, including failed, pending and draft PRs. --all bypasses only PR inventory and exclusion. --dry-run discovers updates without repository scripts, installs, checks or writes to Git. Bare dot deps starts groups by priority and prepares and validates them concurrently in isolated worktrees, bounded by --concurrency. Check commands share the same concurrency cap across groups; setup and shared Git operations are serialised. A command's optional skipFor exclusions apply only when every updated dependency matches; mixed or unknown groups retain checks. The first ready group takes the publication slot and publishes one checked commit without creating PRs or waiting for hosted CI. Host permissions are read from $XDG_CONFIG_HOME/dot/dependencies.json (default ~/.config/dot/dependencies.json), keyed by owner/repository with trusted and allowBypass booleans. Required hosted checks must have equivalent validation.checks mappings; protected direct pushes require explicit allowBypass permission and existing account rights. Workflow edits require a credential with workflow write access. Unsupported policy remains blocking. Git-backed claims serialise each repository/target across machines and service or manual runs. Publication atomically advances the ownership record and target; target movement rebuilds and revalidates, up to three attempts per group. Failed work and per-group logs remain under $XDG_STATE_HOME/dot/dependencies. Clean published worktrees are removed, including submodules. Setup/check mutations and commit-hook mutations prevent publication. Independent groups continue after failures, including groups sharing files; a partial run exits non-zero. A normal invocation authorises passing updates, regardless of Renovate automerge policy.

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

Run configured repositories sequentially under one Git-backed service claim. Configuration supplies coordinationRepository, repositories, intervalMinutes and concurrency. Every repository requires host trust. Shared state prevents overlapping machine runs and records the next eligible interval. Repository/target claims also cover manual dot deps runs. Claims renew every 30 seconds and expire after two minutes; a lost claim interrupts work, and dependency publication atomically checks its target claim. State is stored on dedicated dot-deps-state branches. The user timer polls every 15 minutes. Exit status 2 means completed with unsuccessful update groups (warning); 3 means the shared interval was skipped. Startup, policy and service failures exit 1. Local configuration validation with --dry-run performs no remote writes. Policy is read from published target commits, so repository policies must be pushed before enabling the service.

**Options**

| Option | Description |
| --- | --- |
| `--config` `<string>` | Service JSON config (default: $XDG_CONFIG_HOME/dot/dependency-service.json) |
| `--dry-run` | Validate local service configuration and trust without running updates or writing to Git |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot deps service --dry-run
dot deps service
```

### `dot deps import-renovate`

Import Renovate policy into dot-deps.yml with an editor schema

```text
dot deps import-renovate [flags] [<directory>]
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
dot deps import-renovate
dot deps import-renovate /path/to/repository
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

## `dot updates`

Check watched package and Dotfiles updates for the status bar

```text
dot updates <subcommand> [flags]
```

Read cached status immediately and refresh it in the background after 15 minutes. Refresh checks watched repository/AUR packages and all dot-managed repositories, writes the cache atomically under a shared lock, and notifies the Omarchy shell. Scheduled refreshes respect AUR HTTP-error backoff; manual refreshes retry immediately. Use --package-file, --cache-dir, --timeout, and status --cache-max-age to override defaults.

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
| `--help` `-h` | Show help information |

**Examples**

```bash
dot updates status
```

### `dot updates refresh`

Refresh package and Dotfiles status and notify the shell

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

Each job registers itself with a JSON descriptor in ~/.config/dot/services.d/, shipped by the stow package that owns the unit. A descriptor names the unit and its monitoring policy: label, history, failAfter (consecutive failures before a job counts as failed), staleAfter (a duration such as "1 hour"), restartLimit ({ count, within }) for long-running services, notify, and logs ({ dir, file }) for jobs that keep their own run logs. Optional exitStatuses maps non-zero exit codes to "warning" or "skipped", for example { "2": "warning", "3": "skipped" }. Warnings break the failure streak and count as completed work for staleness; skipped invocations retain the last completed outcome. These are monitor classifications; systemd still records non-zero exits. Run history comes from the user journal. Units with OnFailure=dot-service-failed@%n.service call dot services notify, which raises a desktop notification once failAfter is reached and refreshes the timmo.services panel.

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

### `dot services logs`

Open a registered job's logs in a dotfiles Herdr tab

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

## `dot omarchy-plugin`

Manage Omarchy plugin submodules. The manage-omarchy-plugin compatibility wrapper may pass trailing 0/1 confirmation and commit-offer values to update and remove.

```text
dot omarchy-plugin <subcommand> [flags]
```

Import, update, or remove Omarchy plugins managed as dotfiles submodules. The Omarchy plugin lifecycle hook calls this command through the manage-omarchy-plugin compatibility wrapper.

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
dot omarchy-plugin update timmo.clock --yes
dot omarchy-plugin remove timmo.clock
```

### `dot omarchy-plugin add`

Import a validated plugin checkout

```text
dot omarchy-plugin add [flags] <id> <url> <checkout>
```

**Options**

| Option | Description |
| --- | --- |
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

### `dot omarchy-plugin update`

Update one or all managed plugins

```text
dot omarchy-plugin update [flags] [<id>] [<confirm>]
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

### `dot omarchy-plugin remove`

Remove a managed plugin

```text
dot omarchy-plugin remove [flags] <id> [<confirm>] [<save>]
```

**Options**

| Option | Description |
| --- | --- |
| `--yes` | Remove without confirmation |
| `--no-commit-offer` | Do not offer the optional git-commit handoff |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<id>` | Managed plugin ID |
| `<confirm>` | Compatibility confirmation value |
| `<save>` | Compatibility commit-offer value |

## `dot snapshot`

Save a CPU and memory snapshot with process rankings

```text
dot snapshot [flags]
```

Print a Markdown CPU and memory summary with a usage-filtered process tree. --sort mem defaults to an 80 MiB measured subtree PSS cutoff; --sort cpu defaults to 1% of one core. Adjust these with --min-memory-mib and --min-cpu. Each tree row shows aligned memory and CPU totals beside the process name. Totals include hidden children, so small workers can qualify together; parent and child totals overlap. Expand the largest remaining qualifying branch until --limit visible processes are reached (default: 40, including ancestors). Zero-usage branches are omitted. The saved report adds CPU, memory and process-name rankings with the same cutoffs and per-table limit, plus pressure measurements. Interactive human runs open it in $EDITOR (vi if unset). The internal dot is-agent check automatically selects JSON. JSON retains all sampled processes and the complete processTree, and reportSelection identifies visible PIDs, cutoffs, the limit and omitted count. Missing measurements are null; unavailable parents are marked. CPU is sampled over approximately one second; 100% per process means one logical CPU. PSS divides shared pages between processes. Reports are saved in the system temporary directory ($TMPDIR, normally /tmp), named dot-snapshot-<timestamp>.md or .json. Existing output files are never overwritten.

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

## `dot omarchy-shell-config`

Regenerate the Omarchy shell layout

```text
dot omarchy-shell-config [flags]
```

Regenerate ~/.config/omarchy/shell.json from Omarchy's shipped default and the host-specific dotfiles layout without running the full stow flow.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot omarchy-shell-config
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

## `dot agents-sync`

Mirror AGENTS.md to agent harness instruction files

```text
dot agents-sync [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

## `dot notes-capture-sync`

Sync watched repositories to the notes capture picker

```text
dot notes-capture-sync [flags]
```

Regenerate the notes capture repository picker from repositories with GitHub notifications enabled in the private dot-git.yml configuration. Updates only CAPTURE_REPOSITORIES in the ignored capture/wrangler.local.jsonc file, creating it from the deploy template when needed. Mirrors non-secret settings from the active Worker, then deploys when the live picker differs.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot notes-capture-sync
```

## `dot setup-private-repo`

Sync and register the private pacman repository

```text
dot setup-private-repo [flags]
```

Sync the private Arch package repo mirror, write the private pacman repo snippet, and add the Include line to /etc/pacman.conf when it is missing. This repairs Omarchy pacman.conf refreshes that remove local repository includes. Privileged writes prefer pkexec and fall back to sudo.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot setup-private-repo
```

## `dot setup-public-repo`

Trust and register the public timmo pacman repository

```text
dot setup-public-repo [flags]
```

Download the public signing key, require its pinned full fingerprint, locally sign it in pacman's keyring, and register the signed [timmo] repository before the other package repositories. The command fails before changing trust or pacman configuration when the repository is unavailable or the downloaded fingerprint does not match.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot setup-public-repo
```

## `dot git-diff`

Aliases: `dot diff`

Show repository change state across all tracked repositories.

```text
dot git-diff [flags]
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
dot git-diff
dot git-diff --bar-json
dot git-diff --panel-json
```

## `dot git-web`

Open a Git web action using the repository's configured browser

```text
dot git-web [flags]
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
dot git-web
dot git-web --browser work
dot git-web --url https://github.com/example/project/issues/1
```

## `dot git-commit`

Commit staged changes through the guarded gateway. Subjects must be one line, have no trailing full stop, and stay within the hard length limit. Explicit --path scopes never imply git add -A; --amend keeps the existing message unless --message is supplied.

```text
dot git-commit [flags]
```

Create a commit through dot's guarded gateway instead of raw git commit. The subject is validated as a single line with no trailing full stop and a length limit, then the staged set (or an explicit --path scope) is committed. It never runs git add -A.

Pass --amend to rewrite the previous commit instead of creating a new one; it keeps the existing message unless you pass --message. With --push, an amend force-pushes with --force-with-lease, never a plain force. Agents are routed here by the git-commit skill and blocked from raw git commit in the OpenCode permission config.

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
dot git-commit -m "Add commit gateway"
dot git-commit -m "Scope to one file" --path src/git/commands/Status.ts
dot git-commit -m "Commit and push" --push
dot git-commit --amend
dot git-commit --amend -m "Reword the previous commit"
dot git-commit -m "Preview only" --dry-run
```

## `dot git-notifications`

Open the authenticated GitHub notification inbox. Without output, query or action flags, this opens the Omarchy shell panel. --all and --participating return filtered bar JSON.

```text
dot git-notifications <subcommand> [flags]
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
dot git-notifications
dot git-notifications --bar-json
dot git-notifications --participating
dot git-notifications dismiss --dry-run
dot git-notifications --mark-read 12345
```

### `dot git-notifications dismiss`

Show a coloured repository summary, then review merged dependencies followed by remaining unread notifications. Done queues work in the background while progress appears above the next choices. Every repository offers Done, Open on GitHub, Skip and Stop. Stop ends the questions and finishes queued work before a completion and issues summary. --repo selects a single notification stack. Bar hiding preferences do not restrict this inbox.

```text
dot git-notifications dismiss <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Configured repository name/path or GitHub owner/repository |
| `--dry-run` | Print repository batches and reasons without changing notifications |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot git-notifications dismiss
dot git-notifications dismiss --repo owner/repository
dot git-notifications dismiss --dry-run
dot git-notifications dismiss dependencies --mode all
dot git-notifications dismiss remaining
```

#### `dot git-notifications dismiss dependencies`

Review unread merged Renovate/Dependabot updates regardless of CI results. All-mode excludes unverifiable CI. Opening GitHub returns to the review without dismissing anything.

```text
dot git-notifications dismiss dependencies [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Configured repository name/path or GitHub owner/repository |
| `--dry-run` | Print repository batches and reasons without changing notifications |
| `--mode` `<choice>` | Mark all verified dependencies done, or prompt per repository; omit to choose (choices: all, repos) |
| `--help` `-h` | Show help information |

#### `dot git-notifications dismiss remaining`

Review all other unread notifications per repository, including PRs with unresolved CI and their reasons. This pass always requires a choice before dismissal.

```text
dot git-notifications dismiss remaining [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Configured repository name/path or GitHub owner/repository |
| `--dry-run` | Print repository batches and reasons without changing notifications |
| `--help` `-h` | Show help information |

## `dot git-releases`

Compare enabled repositories with their latest published stable release, explain impact and retain local reviews.

```text
dot git-releases <subcommand> [flags]
```

Read the last local snapshot, collecting one on first use. --refresh fetches immutable release and branch refs immediately; --scheduled follows each repository's local-time cron and records attempted minutes. Draft and prerelease releases are excluded. Failed checks retain previous evidence marked stale. Quiet changes remain inspectable. Desktop notifications require --notify and honour configured minimum impact and cooldown. --open opens the release review, optionally selected by --repo, without fetching.

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
dot git-releases
dot git-releases --refresh --panel-json
dot git-releases --scheduled --notify --panel-json
dot git-releases --open --repo example/project
dot git-releases review --repo example/project --snapshot ID --finding FINDING --impact patch
dot git-releases review --repo example/project --snapshot ID --impact auto
```

### `dot git-releases review`

Review exact local release evidence without publishing anything

```text
dot git-releases review [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Configured repository name or GitHub slug |
| `--snapshot` `<string>` | Exact displayed snapshot ID; stale selections are rejected |
| `--panel-json` | Return the updated complete JSON snapshot |
| `--finding` `<string>` | Finding ID, or overall for the current release-relevant comparison |
| `--impact` `<choice>` | Local release impact; auto clears the override (choices: none, patch, minor, major, auto) |
| `--help` `-h` | Show help information |

### `dot git-releases publish`

Preview version changes, validation, pushes and generated release notes. --interactive explains and confirms in the terminal; --confirm PLAN executes a reviewed plan with live progress.

```text
dot git-releases publish [flags]
```

Requires an explicit private releases.publish recipe. The preview is read-only. Confirmation binds the reviewed snapshot, version files, commands and target. Preparation runs in an isolated worktree. Only agreed version changes are committed through dot git-commit, then the version commit and tag are pushed atomically. GitHub release notes are generated from the previous stable release. Progress includes command output and a saved log. Release creation does not wait for GitHub publication jobs; follow the returned Actions URL. Failed preparation is retained for inspection. Refresh and preview again after resolving a failure.

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Configured repository name or GitHub slug |
| `--snapshot` `<string>` | Exact displayed snapshot ID; stale selections are rejected |
| `--panel-json` | Stream JSON progress and the final plan or release result |
| `--interactive` | Explain, confirm and run the release in this terminal, with an optional log pager |
| `--confirm` `<string>` | Execute the exact plan ID returned by the preview |
| `--help` `-h` | Show help information |

## `dot git-pull-requests`

Track open pull requests for enabled repositories, independently of GitHub notifications

```text
dot git-pull-requests [flags]
```

Opt in with pull_requests.enabled in private dot-git.yml. All open PRs are included, including drafts and automation, ordered by latest update. A non-draft PR is ready when at least one CI check passes and none fail, remain pending or are cancelled; failed check names are shown in the panel. Queries fetch at most every five minutes unless --refresh is supplied. Failed fetches retain the last successful list and report an error. Pull requests stay listed until closed or merged.

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Select an enabled repository by name or GitHub slug |
| `--refresh` | Fetch now instead of using the five-minute cache |
| `--open` | Open the tracked pull request page in the Git panel |
| `--panel-json` | Return enabled repositories and their open pull requests as JSON |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot git-pull-requests --panel-json
dot git-pull-requests --refresh
dot git-pull-requests --open
```

## `dot mcp-sync`

Regenerate MCP configs for all harnesses from the spec

```text
dot mcp-sync [flags]
```

Regenerate each active harness's native MCP config from the private spec (mcp.yml). Repository opencode_mcp lists in dot-git.yml opt into named servers using generated, Git-ignored .opencode/opencode.jsonc files; removing an opt-in removes its generated config. Existing unowned or tracked configs are preserved and reported as conflicts. Global configs are written into the stowed private source tree; run dot stow after. Some agent harnesses are documented stubs and are not written.

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot mcp-sync
```

## `dot private-pkg-publish`

Build and publish a private package

```text
dot private-pkg-publish [flags] <package-name>
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
dot private-pkg-publish twitch-notifications --install
dot private-pkg-publish --skip-build --no-git twitch-notifications
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
dot skills updates [flags]
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
dot skills updates --update --skill browser-control --no-commit
```

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
dot skills check --skill browser-control
```

### `dot skills updates-agent`

Run skill update automation

```text
dot skills updates-agent <subcommand> [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

#### `dot skills updates-agent github`

Run GitHub skill update automation

```text
dot skills updates-agent github [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--skills-dir` `<path>` | Use this Skills checkout |
| `--help` `-h` | Show help information |

#### `dot skills updates-agent device`

Run local device skill update automation

```text
dot skills updates-agent device [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--config` `<path>` | Use this YAML config |
| `--run-id` `<string>` | Wait for this workflow run |
| `--help` `-h` | Show help information |

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

## `dot is-agent`

Detect whether an AI coding agent is running dot

```text
dot is-agent [flags]
```

Detect whether dot is running under an agent harness from agent environment variables, falling back to a Linux /proc process-ancestry check. Exits 0 when an agent is detected and 1 otherwise, so scripts can branch with `if dot is-agent`. Set DOT_AGENT=1 to force detection on or DOT_AGENT=0 to force it off.

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
dot is-agent
dot is-agent --quiet
dot is-agent --json
dot is-agent && echo running under an agent
```

## `dot repo-induct`

Induct a local repository into private dot git config with a preview before committing

```text
dot repo-induct [flags] [<path>]
```

The terminal wizard asks for Normal (first and default) or Home Assistant, then every repository field using private dot-git-presets.yml defaults and local Git identity. Flags prefill the wizard. With --noninteractive, flags override preset defaults and the command only previews; repeat the reviewed options with --commit to save. Each run validates the complete config and shows the exact diff. The config must be tracked and clean; active commit hooks are refused. Existing entries and formatting are preserved. Commits through dot git-commit without pushing or including unrelated staged files. Repositories already inducted are rejected; use agent-oxlint --opt-in to enable their agent pass.

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
| `--noninteractive` | Use flags and preset defaults without questions; preview by default |
| `--commit` | Commit the proposed entry with --noninteractive after reviewing its preview |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<path>` | path |

**Examples**

```bash
dot repo-induct
dot repo-induct ~/repos/example --noninteractive --preset normal --name Example --aliases example
dot repo-induct ~/repos/example --noninteractive --preset normal --name Example --aliases example --commit
```

## `dot agent-oxlint`

Run the advisory generic Oxlint pass for cleanup work in an opted-in repository. Repository-owned Oxlint takes precedence. Pass changed paths normally, or use --all when explicitly requested. Pass --force to run despite those skips.

```text
dot agent-oxlint [flags] [<path...>]
```

Run the generic @timmo001/oxlint-rules recommended config from a dot-managed cache without changing the target repository. The current repository must set agent_oxlint: true in private dot-git.yml. Repositories with their own Oxlint config, dependency, script, or local binary are skipped because their local setup takes precedence. Pass --force to run anyway. Diagnostics are advisory for cleanup work and do not make these personal rules authoritative for the host repository.

**Modes**

```text
<path>...  Lint explicit changed files or directories
--all      Lint the complete repository tree
--force    Run even if opt-in or repository Oxlint would skip
--opt-in   Enable and commit the existing config entry; add paths or --all to also lint
```

**Options**

| Option | Description |
| --- | --- |
| `--all` | Lint the complete repository tree |
| `--opt-in` | Enable the existing private config entry and commit the single-line change |
| `--force` | Run even if the repository is not opted in or already has Oxlint |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<path>` | path |

**Opt-in**

```text
--opt-in adds or sets only agent_oxlint: true in an existing private repository entry, preserving all other bytes. If the entry is missing, it offers the repo-induct wizard with agent Oxlint prefilled as enabled. Without a terminal it prints induction instructions. The config must be tracked and clean. Active commit hooks are refused rather than bypassed so formatters cannot expand the change. Commits through dot git-commit without pushing; unrelated staged files are excluded. An existing opt-in creates no commit.
```

**Examples**

```bash
dot agent-oxlint src/example.ts
dot agent-oxlint src/one.ts src/two.ts
dot agent-oxlint --all
dot agent-oxlint --force src/example.ts
dot agent-oxlint --opt-in
```

## `dot pr-queue`

List reviewable pull requests and what was opened, merged or closed recently

```text
dot pr-queue [flags]
```

Run the repository's review_search from private dot-git.yml (or --search) and classify each pull request deterministically: size from changed lines, failing and pending checks, latest reviews, review decision, unresolved review threads by author, labels, comment count and first-time contributors. --threads adds each unresolved thread's comments. Effort groups are small (up to 150 changed lines), medium (up to 400) and large; a failing check or requested changes makes a pull request not ready. The activity window lists every pull request merged, closed without merging or opened since --since, newest first, with size and labels, plus the net change in open pull requests. Read-only.

**Options**

| Option | Description |
| --- | --- |
| `--repo` `<string>` | Repository slug (default: the current checkout) |
| `--search` `<string>` | Pull request search overriding review_search from private dot-git.yml |
| `--since` `<string>` | Activity window start: today, yesterday, YYYY-MM-DD (local midnight), an ISO timestamp, or an age such as 12h, 3d or 1w |
| `--sort` `<choice>` | Queue order: effort groups (small, medium, large, not ready), or one table by updated, created or size (choices: effort, updated, created, size) |
| `--only` `<choice>` | Print only the review queue or only the activity window (choices: queue, activity) |
| `--limit` `<integer>` | Maximum queue pull requests |
| `--json` | Print JSON instead of Markdown |
| `--threads` | Include the comments of unresolved review threads for queue pull requests |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot pr-queue
dot pr-queue --only activity --since 2026-09-19
dot pr-queue --sort updated --since 3d --json
```

## `dot pr-watch`

Watch pull request runs, checks and reviews, streaming progress and a full report

```text
dot pr-watch [flags] [<pr...>]
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
dot pr-watch
dot pr-watch --stop-on failure
dot pr-watch 54322 54325 54328 --repo home-assistant/frontend
```

## `dot launch-floating-webapp`

Launch one Omarchy webapp and place its new window in the target monitor's bottom-right corner, or reposition an existing window with --address. Width and height must be positive integers; margins must be non-negative.

```text
dot launch-floating-webapp [flags] [<url>]
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

### `dot herdr repo-open`

Open or focus a repository workspace in the shared Herdr session, attaching a tiled terminal when needed. Commands reuse an idle shell pane by default, checking the focused pane, other panes in its tab, then other tabs before splitting right. --layout vertical always splits right, horizontal splits below, and tab always opens a new tab. --modifiers selects the same behaviour from Qt click/Enter modifiers, with Ctrl taking priority over Alt, then Shift. Placement flags are mutually exclusive. Use --agent to resolve the launcher, label and kind from dot herdr agents; it cannot be combined with a command or --agent-kind. Agent launches wait for readiness and verify the selected kind before naming or prompting. --no-focus leaves the current view alone. --json reports resource IDs, creation flags, agent details and whether the prompt was sent. Without a command or --agent, focus the workspace; an empty command opens a shell using the selected layout.

```text
dot herdr repo-open [flags] <label> <directory> [<tab-label>] [<command>]
```

**Options**

| Option | Description |
| --- | --- |
| `--layout` `<choice>` | Auto reuses an idle shell pane, otherwise splits right; vertical splits right, horizontal splits below, tab opens a new tab (choices: auto, vertical, horizontal, tab) |
| `--modifiers` `<integer>` | Qt keyboard modifier bitmask: Ctrl new tab, Alt split below, Shift split right, otherwise auto |
| `--prompt` `<string>` | Initial prompt to send through Herdr after the agent is ready |
| `--agent-kind` `<string>` | Expected Herdr agent kind for an explicit command |
| `--agent` `<string>` | Installed launcher from dot herdr agents, such as opencode2 |
| `--agent-name` `<string>` | Unique Herdr agent name, assigned before prompting |
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

## `dot workspace-setup`

Launch or reuse desktop apps and rebuild the workspace layout

```text
dot workspace-setup [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--sleep` `<number>` | Wait before running setup logic |
| `--mode` `<choice>` | Use the work or normal layout instead of detecting work time (choices: work, normal) |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot workspace-setup
dot workspace-setup --mode=work
dot workspace-setup --mode=normal
```

## `dot workspace-relayout`

Apply or capture a Hyprland workspace layout

```text
dot workspace-relayout [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--edit` | Capture or overwrite a preset |
| `--help` `-h` | Show help information |

## `dot help`

Show this help menu

```text
dot help [flags] [<command>]
```

**Options**

| Option | Description |
| --- | --- |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<command>` | Command to show help for |
