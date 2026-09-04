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

Run the one-time first-use setup workflow for a fresh machine. Init prepares repos, stow links, mise tools, packages, and machine hooks. After init completes, reboot so the Omarchy session picks up host env, then run dot doctor. Before the bounded workflow starts, init updates or clones the optional private overlay according to DOT_ALLOW_PRIVATE. Use dot update for ongoing maintenance.

**Options**

| Option | Description |
| --- | --- |
| `--confirm` | Compatibility flag; accepted but does not suppress prompts |
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

A full update pulls the public dotfiles, installs Bun dependencies, rebuilds and relaunches dot, then scans and pulls tracked repositories. It trusts tracked mise configs, regenerates completions, installs missing public Arch/AUR packages, runs the required MCP sync, stows, rebuilds again, runs agents sync, backfills the init marker, and starts the resume refresh. It finishes with a summary of updated repositories and completed actions.

Phase flags are inclusive: passing any of --pull, --stow, or --app runs only the selected phases. Scoped runs skip full-update package reconciliation, agents sync, and init-marker backfill. Every mode that reaches the end starts the bounded resume refresh.

**Options**

| Option | Description |
| --- | --- |
| `--pull` | Run the repository pull phase only |
| `--stow` | Generate completions, sync MCP configs, and stow only |
| `--app` | Install Bun dependencies and rebuild the dot binary only |
| `--check` | Report core/system repos behind upstream |
| `--check-all` | Report all tracked repos behind upstream |
| `--no-self-update` | Skip the internal self-update phase |
| `--post-hook-repo` `<string>` | Internal post-hook repository |
| `--help` `-h` | Show help information |

**Exit codes**

```text
0   Update completed, or an update check found nothing behind
1   Fatal workflow failure
2   Update check could not scan repositories
10  Update check found repositories behind upstream
11  Legacy Hypr migration is required
```

## `dot system-update`

Select and run Dotfiles, Omarchy, and Topgrade updates

```text
dot system-update [flags]
```

Select maintenance steps interactively, then run them in order: Dotfiles, Omarchy, and Topgrade. Non-interactive runs and --yes select every step. Cancelling the prompt exits without running updates.

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
| `--open-opencode` | Save the report and attempt to open it in OpenCode |
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
--list-changed  Changed repositories as rows
--list-all      All tracked repositories as rows
```

**Options**

| Option | Description |
| --- | --- |
| `--no-fetch` | Skip fetching from remotes |
| `--raw` | Text summary output |
| `--bar-json` | JSON output for status bars and shell modules |
| `--panel-json` | Full JSON snapshot for the native shell panel |
| `--list-changed` | Changed repos as rows |
| `--list-all` | All tracked repos as rows |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot git-diff
dot git-diff --raw
dot git-diff --bar-json
dot git-diff --panel-json
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

Open the authenticated GitHub notification inbox. Without machine-output or action flags, this opens the Omarchy shell panel. --since accepts ISO/RFC dates, epoch timestamps, compact durations such as 2d, and quoted durations such as "2 days ago".

```text
dot git-notifications [flags]
```

**Modes**

```text
(default)       Open the shell notification panel
--raw           Text summary
--bar-json      Status-bar JSON
--list-threads  Notification rows
--bar-filter    Apply watched-repository filtering
```

**Options**

| Option | Description |
| --- | --- |
| `--raw` | Text summary of notification threads |
| `--bar-json` | JSON output for status bars and shell modules |
| `--list-threads` | Notification threads as rows |
| `--bar-filter` | Apply watched-repo filtering |
| `--all` | Include read notifications |
| `--participating` | Only participating threads |
| `--since` `<string>` | Only include notifications updated after this date |
| `--mark-read` `<string>` | Mark a thread as read |
| `--mark-done` `<string>` | Mark a thread as done |
| `--ignore` `<string>` | Ignore a thread |
| `--unignore` `<string>` | Stop ignoring a thread |
| `--mark-bot-read` | Mark bot notifications as read |
| `--dry-run` | Preview bot marking |
| `--help` `-h` | Show help information |

**Examples**

```bash
dot git-notifications
dot git-notifications --bar-json
dot git-notifications --participating
dot git-notifications --mark-bot-read --dry-run
dot git-notifications --mark-read 12345
```

## `dot mcp-sync`

Regenerate MCP configs for all harnesses from the spec

```text
dot mcp-sync [flags]
```

Regenerate each active harness's native MCP config from the single private spec (mcp.yml), keeping agent harness MCP configs aligned. Writes into the stowed private source tree; run dot stow after. Some agent harnesses are documented stubs and are not written. OpenCode gated servers also receive a default-off tools gate so their tool schemas stay out of the baseline context until an agent re-enables them.

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

Generate shell completions for dot. By default this writes the managed dot and skill-maintenance completion files for the selected shell so the next dot stow installs them. Pass --stdout to print only dot completions.

**Options**

| Option | Description |
| --- | --- |
| `--stdout` | Print instead of writing |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<shell>` | Shell to generate completions for |

**Examples**

```bash
dot completions zsh
dot completions bash --stdout
dot completions fish --stdout
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

## `dot agent-oxlint`

Run the advisory generic Oxlint pass for cleanup work in an opted-in repository. Repository-owned Oxlint takes precedence. Pass changed paths normally, or use --all when explicitly requested.

```text
dot agent-oxlint [flags] [<path...>]
```

Run the generic @timmo001/oxlint-rules recommended config from a dot-managed cache without changing the target repository. The current repository must set agent_oxlint: true in private dot-git.yml. Repositories with their own Oxlint config, dependency, script, or local binary are skipped because their local setup takes precedence. Diagnostics are advisory for cleanup work and do not make these personal rules authoritative for the host repository.

**Modes**

```text
<path>...  Lint explicit changed files or directories
--all      Lint the complete repository tree
```

**Options**

| Option | Description |
| --- | --- |
| `--all` | Lint the complete repository tree |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<path>` | path |

**Examples**

```bash
dot agent-oxlint src/example.ts
dot agent-oxlint src/one.ts src/two.ts
dot agent-oxlint --all
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

## `dot herdr-repo-open`

Open or focus a repository workspace in the shared Herdr session. If the server is headless, open a tiled terminal and wait for a foreground client before focusing the workspace.

```text
dot herdr-repo-open [flags] <label> <directory> [<tab-label>] [<command>]
```

**Options**

| Option | Description |
| --- | --- |
| `--pane` | Run in a new pane |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<label>` | Herdr workspace label |
| `<directory>` | Repository working directory |
| `<tab-label>` | Optional command tab label |
| `<command>` | Optional command to run |

**Exit codes**

```text
0  Repository workspace focused or opened
1  Herdr operation failed
2  Invalid arguments
```

## `dot workspace-setup`

Launch or reuse desktop apps and rebuild the workspace layout

```text
dot workspace-setup [flags]
```

**Options**

| Option | Description |
| --- | --- |
| `--step-through` `--step` | Pause after each logged step |
| `--speed-multiplier` `<number>` | Multiply built-in sleep durations |
| `--sleep` `<number>` | Wait before running setup logic |
| `--fast` | Use a speed multiplier of 1 |
| `--temp-workspace` `<integer>` | Numeric temporary workspace |
| `--move-dispatcher` `<choice>` | Window move dispatcher (choices: movetoworkspace, movetoworkspacesilent) |
| `--log-file` `<path>` | Write the run log to this file |
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

## `dot usage`

Report local-first usage analytics from NDJSON events under $XDG_STATE_HOME/tool-usage. Live events store canonical commands and recognised flag names, never positional values. Set DOT_USAGE_DISABLE=1 to disable live recording or DOT_USAGE_DIR to relocate storage.

```text
dot usage [flags] [<command>]
```

**Modes**

```text
summary   Per-feature usage table (default)
stale     Features not used within the window
path      Print the event storage root
backfill  Import whitelisted shell-history invocations
```

**Options**

| Option | Description |
| --- | --- |
| `--days` `<integer>` | Window in days |
| `--format` `<choice>` | (choices: text, json, agent-context) |
| `--root` `<path>` |  |
| `--history` | Backfill from shell history |
| `--apply` | Write backfilled events |
| `--help` `-h` | Show help information |

**Arguments**

| Argument | Description |
| --- | --- |
| `<command>` | Analytics operation |

**Privacy**

```text
Live dot events never store positional values
Shell-history backfill is a dry run unless --apply is passed
Review history before applying when arguments may contain sensitive text
```

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
