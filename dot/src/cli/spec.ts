/** Named value completion candidates for a CLI option. */
export interface CliValueChoice {
  /** Value inserted on the command line. */
  readonly value: string;
  /** Human-readable completion/help description. */
  readonly description?: string;
}

/** Positional argument shown in help/completion output. */
export interface CliArgumentSpec {
  /** Argument label, without angle brackets. */
  readonly name: string;
  /** Human-readable description. */
  readonly description?: string;
  /** Completion strategy for this argument. */
  readonly completion?: "file" | "shell" | "none";
  /** Fixed completion candidates for this argument. */
  readonly choices?: readonly CliValueChoice[];
  /** Whether the argument can repeat. */
  readonly repeatable?: boolean;
}

/** CLI option/flag metadata. */
export interface CliOptionSpec {
  /** Long option name, including leading dashes. */
  readonly name: `--${string}`;
  /** Optional short option alias, including leading dash. */
  readonly short?: `-${string}`;
  /** Human-readable description. */
  readonly description: string;
  /** Value label shown in help, when the option takes a value. */
  readonly valueName?: string;
  /** Completion strategy for the value. */
  readonly completion?: "file" | "shell" | "none";
  /** Fixed value candidates. */
  readonly choices?: readonly CliValueChoice[];
}

/** Extra help section rendered after options. */
export interface CliHelpSection {
  /** Section title. */
  readonly title: string;
  /** Section lines. */
  readonly lines: readonly string[];
}

/** CLI command/subcommand metadata used for help and completions. */
export interface CliCommandSpec {
  /** Canonical command name. */
  readonly name: string;
  /** Human-readable summary for command listings. */
  readonly summary: string;
  /** Aliases accepted by the CLI. */
  readonly aliases?: readonly string[];
  /** Usage suffix after `dot <name>`. */
  readonly usage?: string;
  /** Long description paragraphs. */
  readonly description?: readonly string[];
  /** Mode lines rendered before options. */
  readonly modes?: readonly string[];
  /** Nested subcommands. */
  readonly commands?: readonly CliCommandSpec[];
  /** Command options. */
  readonly options?: readonly CliOptionSpec[];
  /** Positional arguments. */
  readonly arguments?: readonly CliArgumentSpec[];
  /** Additional help sections. */
  readonly sections?: readonly CliHelpSection[];
  /** Example command lines. */
  readonly examples?: readonly string[];
}

const helpOption = {
  name: "--help",
  short: "-h",
  description: "Show this help message",
} satisfies CliOptionSpec;

const rawOption = {
  name: "--raw",
  description: "Text summary output",
} satisfies CliOptionSpec;

const barJsonOption = {
  name: "--bar-json",
  description: "JSON output for status bars and shell modules",
} satisfies CliOptionSpec;

const openOpencodeOption = {
  name: "--open-opencode",
  description: "Run checks and attempt OpenCode analysis",
} satisfies CliOptionSpec;

/** Top-level native `dot` command descriptors. */
export const cliCommands: readonly CliCommandSpec[] = [
  {
    name: "init",
    summary: "Run one-time first-use machine setup",
    usage: "[options]",
    description: [
      "Run the one-time first-use setup workflow for a fresh machine. Init prepares",
      "repos, stow links, mise tools, packages, and machine hooks. After init",
      "completes, reboot so the Omarchy session picks up host env, then run",
      "dot doctor. Before the bounded workflow starts, init updates or clones the",
      "optional private overlay according to DOT_ALLOW_PRIVATE. Use dot update for",
      "ongoing maintenance.",
    ],
    options: [
      {
        name: "--confirm",
        description:
          "Compatibility flag; accepted but does not suppress prompts",
      },
      {
        name: "--noninteractive",
        description: "Skip the Hypr host questionnaire for this run",
      },
      {
        name: "--interactive",
        description:
          "Enable the Hypr host questionnaire when no host is selected",
      },
      {
        name: "--force",
        description: "Re-run init even if the machine looks initialised",
      },
      {
        name: "--host",
        valueName: "name",
        description:
          "Hypr host to link before stow (default: OMARCHY_HOST or desktop)",
      },
      {
        name: "--log",
        valueName: "path",
        completion: "file",
        description: "Init log path (default: ~/.local/state/dot/init.log)",
      },
      helpOption,
    ],
    examples: [
      "dot init --noninteractive",
      "dot init --host laptop --noninteractive",
      "dot init --force --noninteractive",
    ],
  },
  {
    name: "install",
    summary: "Ensure prerequisites, then backup/adopt dotfiles",
    options: [helpOption],
  },
  {
    name: "update",
    aliases: ["up"],
    summary: "Self-update, pull repos, stow dotfiles, rebuild",
    description: [
      "A full update pulls the public dotfiles, installs Bun dependencies, rebuilds",
      "and relaunches dot, then scans and pulls tracked repositories. It trusts",
      "tracked mise configs, regenerates completions, installs missing public",
      "Arch/AUR packages, runs the required MCP sync, stows, rebuilds again, runs",
      "agents sync, backfills the init marker, and starts the resume refresh.",
      "It finishes with a summary of updated repositories and completed actions.",
      "",
      "Phase flags are inclusive: passing any of --pull, --stow, or --app runs only",
      "the selected phases. Scoped runs skip full-update package reconciliation,",
      "agents sync, and init-marker backfill. Every mode that reaches the end starts",
      "the bounded resume refresh.",
    ],
    options: [
      { name: "--pull", description: "Run the repository pull phase only" },
      {
        name: "--stow",
        description: "Generate completions, sync MCP configs, and stow only",
      },
      {
        name: "--app",
        description: "Install Bun dependencies and rebuild the dot binary only",
      },
      {
        name: "--check",
        description:
          "Report core/system repos behind upstream (no update); exit 10 if any",
      },
      {
        name: "--check-all",
        description:
          "Report all tracked repos behind upstream (no update); exit 10 if any",
      },
      helpOption,
    ],
    sections: [
      {
        title: "Exit codes",
        lines: [
          "0   Update completed, or an update check found nothing behind",
          "1   Fatal workflow failure",
          "2   Update check could not scan repositories",
          "10  Update check found repositories behind upstream",
          "11  Legacy Hypr migration is required before update can continue",
        ],
      },
    ],
  },
  {
    name: "stow",
    summary: "Re-stow public/private dotfiles",
    options: [
      { name: "--public", description: "Stow public dotfiles only" },
      { name: "--private", description: "Stow private dotfiles only" },
      helpOption,
    ],
  },
  {
    name: "omarchy-shell-config",
    summary: "Regenerate the Omarchy shell layout",
    description: [
      "Regenerate ~/.config/omarchy/shell.json from Omarchy's shipped default",
      "and the host-specific dotfiles layout without running the full stow flow.",
    ],
    options: [helpOption],
    examples: ["dot omarchy-shell-config"],
  },
  {
    name: "omarchy-plugin",
    summary: "Manage Omarchy plugin submodules",
    usage: "<add|update|remove> ...",
    description: [
      "Import, update, or remove Omarchy plugins managed as dotfiles submodules.",
      "The Omarchy plugin lifecycle hook calls this command through the",
      "manage-omarchy-plugin compatibility wrapper.",
    ],
    commands: [
      {
        name: "add",
        summary: "Import a validated plugin checkout",
        usage: "<id> <url> <checkout> [options]",
        arguments: [
          { name: "id", description: "Plugin ID" },
          { name: "url", description: "Plugin Git remote" },
          {
            name: "checkout",
            description: "Validated live plugin checkout",
            completion: "file",
          },
        ],
        options: [
          {
            name: "--section",
            valueName: "section",
            description: "Bar section (default: plugin manifest)",
            choices: [
              { value: "left" },
              { value: "center" },
              { value: "right" },
            ],
          },
          {
            name: "--before",
            valueName: "plugin-id",
            description: "Place before this plugin",
          },
          {
            name: "--after",
            valueName: "plugin-id",
            description: "Place after this plugin",
          },
          helpOption,
        ],
      },
      {
        name: "update",
        summary: "Update one or all managed plugins",
        usage: "[id] [options]",
        arguments: [{ name: "id", description: "Managed plugin ID" }],
        options: [
          { name: "--yes", description: "Update without confirmation" },
          helpOption,
        ],
      },
      {
        name: "remove",
        summary: "Remove a managed plugin",
        usage: "<id> [options]",
        arguments: [{ name: "id", description: "Managed plugin ID" }],
        options: [
          { name: "--yes", description: "Remove without confirmation" },
          {
            name: "--no-commit-offer",
            description: "Do not offer the optional git-commit handoff",
          },
          helpOption,
        ],
      },
    ],
    options: [helpOption],
    sections: [
      {
        title: "Exit codes",
        lines: [
          "0   Managed operation completed or was skipped",
          "1   Managed operation failed",
          "20  Plugin is unmanaged; continue with Omarchy's normal operation",
        ],
      },
    ],
    examples: [
      "dot omarchy-plugin update timmo.clock --yes",
      "dot omarchy-plugin remove timmo.clock",
    ],
  },
  {
    name: "firewall",
    summary: "Reconcile managed ufw firewall rules",
    description: [
      "Ensure the managed ufw allow rules are present with their exact source,",
      "destination, interface/direction, and purpose comment. Missing rules are",
      "added, stale-comment rules are deleted and re-added, then ufw is reloaded",
      "once. A source-restricted rule does not satisfy a managed any-source rule.",
    ],
    options: [helpOption],
    examples: ["dot firewall"],
  },
  {
    name: "doctor",
    summary: "Run dotfiles system health checks",
    usage: "[options]",
    description: [
      "Run health checks on the dotfiles system. Verifies dependencies, repos,",
      "stow integrity, systemd timers, packages, browser config, and more.",
      "",
      "All checks run in parallel and each section streams to the terminal as it",
      "finishes, so sections appear in completion order. A grouped summary of any",
      "errors and warnings, ordered by section, follows at the end. A log file is",
      "always written to ~/.local/state/dot/logs/.",
    ],
    options: [
      {
        ...openOpencodeOption,
        description: "Save the report and attempt to open it in OpenCode",
      },
      helpOption,
    ],
    sections: [
      {
        title: "Checks performed",
        lines: [
          "Dependencies         Required/optional CLI tools (git, stow, gh, gum, ...)",
          "gh extensions        Configured gh CLI extensions are installed",
          "Locale               Required locales from shell config are generated",
          "Zsh key bindings     Delete/forward-delete bindings and other expected defaults",
          "Repositories         Public/private dotfiles + private git repos exist and have upstreams",
          "Origin HEAD          Local origin/HEAD tracks the remote default branch (not stale)",
          "Stow integrity       Dry-run restow to detect drift",
          "OpenCode location    Canonical paths, legacy remnants",
          "OpenCode server      Shared Hypr autostart and ~/.config/opencode/.env password",
          "Herdr integration    Herdr binary and OpenCode integration installed",
          "GitHub MCP auth      gh token available for DOT_GH_MCP_BEARER",
          "Git config           Managed include is active",
          "Git notifications    API scope and notification access",
          "Doctor startup       Startup notification timer",
          "uwsm session PATH    ~/.local/bin on the uwsm/systemd user-environment PATH",
          "Daily volume reset   Laptop-only optional timer",
          "Omarchy config       Managed repos and Hypr host-link correctness",
          "Legacy Hypr repo     Flags a retired omarchy-hypr clone at ~/.config/hypr",
          "Neovim theme link    Repairs a mislocated omarchy-nvim theme.lua symlink",
          "Private access       Private dotfiles overlay enabled or explains why it is disabled",
          "Browser flags        Symlinks from private stow package",
          "Hardware video       VAAPI render nodes, drivers, packages",
          "Browser extensions   Private extension check list",
          "Public packages      Pacman/AUR packages installed + version check",
          "Private package repo Private pacman repo registered",
          "Private packages     Private repo + packages installed",
          "Pacman hooks         Hook files installed and up to date",
          "Firewall rules       Managed ufw rules (KDE Connect, Home Assistant, OpenCode, LocalSend, libvirt); repair with dot firewall",
        ],
      },
      {
        title: "Exit codes",
        lines: [
          "0    No critical errors (warnings may still be present)",
          "1    One or more critical errors found",
        ],
      },
    ],
    examples: ["dot doctor", "dot doctor --open-opencode"],
  },
  {
    name: "clean",
    summary: "Unstow managed dotfiles",
    options: [helpOption],
  },
  {
    name: "git-diff",
    aliases: ["diff"],
    summary: "Show repository change state",
    usage: "[options]",
    description: ["Show change state across all tracked repositories."],
    modes: [
      "(default)        Text summary of repos with changes",
      "--raw            Text summary of repos with changes",
      "--bar-json      JSON output for status bars and shell modules",
      "--panel-json    Full JSON snapshot for the native shell panel",
      "--list-changed   Changed repos as name|path rows",
      "--list-all       All tracked repos as name|path rows",
    ],
    options: [
      {
        name: "--no-fetch",
        description: "Skip fetching from remotes (use local refs only)",
      },
      rawOption,
      barJsonOption,
      {
        name: "--panel-json",
        description: "Full JSON snapshot for the native shell panel",
      },
      { name: "--list-changed", description: "Changed repos as rows" },
      { name: "--list-all", description: "All tracked repos as rows" },
      helpOption,
    ],
    examples: [
      "dot git-diff",
      "dot git-diff --raw",
      "dot git-diff --bar-json",
      "dot git-diff --panel-json",
    ],
  },
  {
    name: "git-commit",
    summary: "Commit staged changes through the guarded gateway",
    usage: "--message <subject> [options] | --amend [options]",
    description: [
      "Create a commit through dot's guarded gateway instead of raw git commit.",
      "The subject is validated as a single line with no trailing full stop and",
      "a length limit, then the staged set (or an explicit --path scope) is",
      "committed. It never runs git add -A.",
      "",
      "Pass --amend to rewrite the previous commit instead of creating a new",
      "one; it keeps the existing message unless you pass --message. With",
      "--push, an amend force-pushes with --force-with-lease (never a plain",
      "force).",
      "",
      "Agents are routed here by the git-commit skill and blocked from raw",
      "git commit in the OpenCode permission config, so commits stay in the",
      "maintainer's concise one-line style.",
    ],
    modes: [
      "(default)     Commit the staged set",
      "--path        Commit only the named files",
      "--amend       Rewrite the previous commit",
      "--dry-run     Preview the plan, change nothing",
    ],
    options: [
      {
        name: "--message",
        short: "-m",
        valueName: "subject",
        description: "Single-line commit subject (required unless --amend)",
      },
      {
        name: "--path",
        valueName: "file",
        completion: "file",
        description: "Commit only this file; repeatable",
      },
      {
        name: "--amend",
        description:
          "Amend the previous commit; keeps its message unless --message is given",
      },
      {
        name: "--push",
        description:
          "Push the current branch after committing (pulls --rebase first, or force-with-lease when amending, never a plain force)",
      },
      {
        name: "--dry-run",
        description:
          "Preview the commit and push plan without changing anything",
      },
      helpOption,
    ],
    sections: [
      {
        title: "Message guards",
        lines: [
          "Single line     Rejects multi-line messages",
          "No em/en-dash   Rejects '\u2014' and '\u2013'; use a hyphen",
          "No full stop    Rejects a trailing '.'",
          "Warn over 60    Warns on stderr, still commits",
          "Reject over 120 Fails; shorten the subject",
        ],
      },
      {
        title: "Base branch guard",
        lines: [
          "Refuses commits to the base branch of a repo you do not own,",
          "including a fork kept for upstream PRs. Owners you control are",
          "listed in `git config dot.owner`. Work on a feature branch.",
        ],
      },
    ],
    examples: [
      'dot git-commit -m "Add commit gateway"',
      'dot git-commit -m "Scope to one file" --path src/git/commands/Status.ts',
      'dot git-commit -m "Commit and push" --push',
      "dot git-commit --amend",
      'dot git-commit --amend -m "Reword the previous commit"',
      'dot git-commit -m "Preview only" --dry-run',
    ],
  },
  {
    name: "git-notifications",
    summary: "Open GitHub notification inbox",
    usage: "[options]",
    description: [
      "Open the authenticated user's GitHub notification inbox. Without machine or",
      "action flags, opens the Omarchy shell panel.",
    ],
    modes: [
      "(default)       Omarchy shell notifications panel",
      "--raw           Text summary of notification threads",
      "--bar-json     JSON output for status bars and shell modules",
      "--list-threads  Notification threads as rows",
      "--bar-filter    Apply watched-repo filtering in raw/list output",
    ],
    options: [
      { ...rawOption, description: "Text summary of notification threads" },
      barJsonOption,
      { name: "--list-threads", description: "Notification threads as rows" },
      {
        name: "--bar-filter",
        description: "Apply watched-repo filtering in raw/list output",
      },
      { name: "--all", description: "Include read notifications" },
      {
        name: "--participating",
        description: "Only include participating or mentioned threads",
      },
      {
        name: "--since",
        valueName: "date",
        description: "Only include notifications updated after this date",
      },
      {
        name: "--mark-read",
        valueName: "id",
        description: "Mark a notification thread as read",
      },
      {
        name: "--mark-bot-read",
        description:
          "Mark unread Renovate/Dependabot/bot notifications as read",
      },
      {
        name: "--dry-run",
        description: "Preview --mark-bot-read without mutating GitHub state",
      },
      {
        name: "--mark-done",
        valueName: "id",
        description: "Mark a notification thread as done",
      },
      {
        name: "--ignore",
        valueName: "id",
        description: "Ignore new notifications for a thread",
      },
      {
        name: "--unignore",
        valueName: "id",
        description: "Stop ignoring notifications for a thread",
      },
      helpOption,
    ],
    examples: [
      "dot git-notifications",
      "dot git-notifications --bar-json",
      "dot git-notifications --participating",
      "dot git-notifications --mark-bot-read --dry-run",
      "dot git-notifications --mark-read 12345",
    ],
  },
  {
    name: "agents-sync",
    summary: "Mirror AGENTS.md to agent harness instruction files",
    options: [helpOption],
  },
  {
    name: "mcp-sync",
    summary: "Regenerate MCP configs for all harnesses from the spec",
    description: [
      "Regenerate each active harness's native MCP config from the single",
      "private spec (mcp.yml), keeping agent harness MCP configs aligned.",
      "Writes into the stowed private source tree; run dot stow after.",
      "",
      "Some agent harnesses are documented stubs and are not written.",
      "OpenCode gated servers also receive a default-off tools gate so their",
      "tool schemas stay out of the baseline context until an agent re-enables",
      "them.",
    ],
    options: [helpOption],
    examples: ["dot mcp-sync"],
  },
  {
    name: "notes-capture-sync",
    summary: "Sync watched repositories to the notes capture picker",
    description: [
      "Regenerate the notes capture repository picker from repositories with",
      "GitHub notifications enabled in the private dot-git.yml configuration.",
      "Updates only CAPTURE_REPOSITORIES in the ignored",
      "capture/wrangler.local.jsonc file, creating it from the deploy template",
      "when needed. Mirrors non-secret settings from the active Worker, then",
      "deploys when the live picker differs.",
    ],
    options: [helpOption],
    examples: ["dot notes-capture-sync"],
  },
  {
    name: "is-agent",
    summary: "Detect whether an AI coding agent is running dot",
    usage: "[options]",
    description: [
      "Detect whether dot is running under an agent harness from agent",
      "environment variables, falling back to a Linux",
      "/proc process-ancestry check. Exits 0 when an agent is detected and 1",
      "otherwise, so scripts can branch with `if dot is-agent`.",
      "",
      "Set DOT_AGENT=1 to force detection on or DOT_AGENT=0 to force it off.",
    ],
    modes: [
      "(default)   Print the detected agent, or a no-agent message",
      "--quiet     Print only the provider id (nothing when no agent)",
      "--json      Print the detection result as JSON",
    ],
    options: [
      {
        name: "--quiet",
        short: "-q",
        description: "Print only the provider id",
      },
      { name: "--json", description: "Print the detection result as JSON" },
      helpOption,
    ],
    examples: [
      "dot is-agent",
      "dot is-agent --quiet",
      "dot is-agent --json",
      "dot is-agent && echo running under an agent",
    ],
  },
  {
    name: "setup-public-repo",
    summary: "Trust and register the public timmo pacman repository",
    description: [
      "Download the public signing key, require its pinned full fingerprint,",
      "locally sign it in pacman's keyring, and register the signed [timmo]",
      "repository before the other package repositories.",
      "",
      "The command fails before changing trust or pacman configuration when the",
      "repository is unavailable or the downloaded fingerprint does not match.",
    ],
    options: [helpOption],
    examples: ["dot setup-public-repo"],
  },
  {
    name: "setup-private-repo",
    summary: "Sync and register the private pacman repository",
    description: [
      "Sync the private Arch package repo mirror, write the private pacman repo",
      "snippet, and add the Include line to /etc/pacman.conf when it is missing.",
      "",
      "This repairs Omarchy pacman.conf refreshes that remove local repository",
      "includes. Privileged writes prefer pkexec and fall back to sudo.",
    ],
    options: [helpOption],
    examples: ["dot setup-private-repo"],
  },
  {
    name: "private-pkg-publish",
    summary: "Build and publish a private package",
    usage: "[options] <package-name>",
    description: [
      "Build and publish a mapped private package into the private pacman repo.",
    ],
    options: [
      { name: "--no-git", description: "Skip package repo commit and push" },
      {
        name: "--skip-build",
        description: "Publish an existing dist package artifact",
      },
      {
        name: "--install",
        description: "Install the published package after syncing the mirror",
      },
      helpOption,
    ],
    arguments: [{ name: "package-name" }],
    examples: [
      "dot private-pkg-publish twitch-notifications --install",
      "dot private-pkg-publish --skip-build --no-git twitch-notifications",
    ],
  },
  {
    name: "skill-updates",
    summary: "Check/apply imported skill updates",
    options: [
      { name: "--check", description: "Check only without applying" },
      { name: "--update", description: "Auto-apply clean updates" },
      {
        name: "--json",
        description: "Report update states as JSON without applying",
      },
      {
        name: "--skill",
        valueName: "name",
        description: "Limit checking or updating to one imported skill",
      },
      {
        name: "--no-commit",
        description: "Apply updates without creating a commit",
      },
      { name: "--skip-review", description: "Skip local-edit review" },
      helpOption,
    ],
    examples: [
      "dot skill-updates --json",
      "dot skill-updates --update --skill browser-control --no-commit",
    ],
  },
  {
    name: "skill-check",
    summary: "Validate skill maintenance and adapted imports",
    description: [
      "Validate branch-context wiring and ensure adapted imported skills still",
      "differ from every file in their current upstream source.",
      "",
      "When an adapted skill exactly matches its source, human sessions can",
      "reimport it through the standard Skills CLI. Agent sessions print the",
      "equivalent command instead.",
    ],
    options: [
      openOpencodeOption,
      {
        name: "--diff-origin",
        description:
          "Diff imported skills against their upstream origins; with --open-opencode, include the diff in the prompt",
      },
      {
        name: "--skill",
        valueName: "name",
        description: "Check one adapted imported skill only",
      },
      helpOption,
    ],
    examples: ["dot skill-check --skill browser-control"],
  },
  {
    name: "skill-updates-agent",
    summary: "Run GitHub or device skill update automation",
    usage: "<github|device> [options]",
    description: [
      "Run the shared skill update workflow. GitHub mode checks imports, opens",
      "clean update pull requests, dispatches validation, and refreshes the",
      "dashboard. Device mode optionally waits for that workflow, then runs the",
      "configured local OpenCode processor with completed-run deduplication.",
    ],
    options: [
      {
        name: "--config",
        valueName: "path",
        completion: "file",
        description:
          "Use a YAML config other than private dotfiles/skill-updates-agent.yml",
      },
      {
        name: "--run-id",
        valueName: "id",
        description: "Wait for this workflow run before device processing",
      },
      {
        name: "--skills-dir",
        valueName: "path",
        completion: "file",
        description: "Use this Skills checkout in GitHub mode",
      },
      helpOption,
    ],
    arguments: [
      {
        name: "mode",
        choices: [
          { value: "github", description: "Run the GitHub Actions phase" },
          { value: "device", description: "Run the local OpenCode phase" },
        ],
      },
    ],
    examples: [
      "dot skill-updates-agent github --skills-dir .",
      "dot skill-updates-agent device --config ~/.config/dotfiles-private/skill-updates-agent.yml --run-id 123456",
    ],
  },
  {
    name: "completions",
    summary: "Generate shell completions",
    usage: "[bash|fish|zsh] [--stdout]",
    description: [
      "Generate shell completions for dot.",
      "",
      "By default this writes the managed completion file for the selected shell",
      "in the public dotfiles repo so the next dot stow installs it.",
    ],
    options: [
      {
        name: "--stdout",
        description: "Print the completion script instead of writing it",
      },
      helpOption,
    ],
    arguments: [
      {
        name: "shell",
        choices: [{ value: "bash" }, { value: "fish" }, { value: "zsh" }],
        completion: "shell",
      },
    ],
    examples: [
      "dot completions zsh",
      "dot completions bash --stdout",
      "dot completions fish --stdout",
    ],
  },
  {
    name: "herdr-repo-open",
    summary: "Open or focus a repository in Herdr",
    usage: "[--pane] <label> <directory> [tab-label command]",
    description: [
      "Open or focus a repository workspace in the shared Herdr session. If the",
      "Herdr server is headless, open a tiled terminal and wait for it before",
      "focusing the workspace.",
    ],
    options: [
      {
        name: "--pane",
        description: "Run the command in a new pane instead of a new tab",
      },
      helpOption,
    ],
    arguments: [
      { name: "label", description: "Herdr workspace label" },
      {
        name: "directory",
        description: "Repository working directory",
        completion: "file",
      },
      { name: "tab-label", description: "Optional command tab label" },
      { name: "command", description: "Optional command to run" },
    ],
    examples: [
      "dot herdr-repo-open Dotfiles ~/.config/dotfiles",
      "dot herdr-repo-open Dotfiles ~/.config/dotfiles OpenCode opencode",
      "dot herdr-repo-open --pane Dotfiles ~/.config/dotfiles Lazygit lazygit",
    ],
  },
  {
    name: "launch-floating-webapp",
    summary: "Launch or reposition a floating webapp",
    usage: "[options] <url> | [options] --address <window-address>",
    description: [
      "Launch one Omarchy webapp and place only its new window in the target",
      "monitor's bottom-right corner. Pass --address to reposition an existing",
      "window instead. The resolved Hyprland address is the only stdout output.",
    ],
    options: [
      {
        name: "--monitor",
        valueName: "name",
        description: "Target monitor (default: focused monitor)",
      },
      {
        name: "--workspace",
        valueName: "id",
        description: "Move to this workspace and use its monitor",
      },
      {
        name: "--width",
        valueName: "px",
        description: "Window width (default: 380)",
      },
      {
        name: "--height",
        valueName: "px",
        description: "Window height (default: 500)",
      },
      {
        name: "--right-margin",
        valueName: "px",
        description: "Right margin (default: 16)",
      },
      {
        name: "--bottom-margin",
        valueName: "px",
        description: "Bottom margin (default: 6)",
      },
      {
        name: "--address",
        valueName: "window-address",
        description: "Reposition an existing window instead of launching",
      },
      helpOption,
    ],
    arguments: [
      {
        name: "url",
        description: "Webapp URL to launch",
        completion: "none",
      },
    ],
    sections: [
      {
        title: "Exit codes",
        lines: [
          "0  Window placed and its address printed",
          "1  Launch detection, Hyprland query, or placement failed",
          "2  Invalid arguments",
        ],
      },
    ],
    examples: [
      "dot launch-floating-webapp https://example.com",
      "dot launch-floating-webapp --workspace 3 https://example.com",
      "dot launch-floating-webapp --address 0x123abc",
    ],
  },
  {
    name: "workspace-relayout",
    summary: "Apply or capture a Hyprland workspace layout",
    usage: "[--edit]",
    description: [
      "Apply a saved ratio-based Dwindle layout to the active workspace, or",
      "capture the current tiled window geometry into a preset with --edit.",
      "The command validates presets and temporary workspace availability before",
      "moving windows, then verifies the result and attempts rollback on failure.",
    ],
    options: [
      { name: "--edit", description: "Capture or overwrite a layout preset" },
      helpOption,
    ],
    examples: ["dot workspace-relayout", "dot workspace-relayout --edit"],
  },
  {
    name: "workspace-capture",
    summary: "Capture Hyprland workspace and window state",
    usage: "[options]",
    description: [
      "Write a version 2 workspace session containing Hyprland clients, process",
      "metadata, active workspace state, monitor state, and available browser URLs.",
    ],
    options: [
      {
        name: "--current-workspace",
        description: "Capture only visible clients on the active workspace",
      },
      {
        name: "--output",
        valueName: "file",
        completion: "file",
        description:
          "Write to this file instead of the default state directory",
      },
      {
        name: "--state-dir",
        valueName: "dir",
        completion: "file",
        description: "Directory for default captures and capture.log",
      },
      helpOption,
    ],
    examples: [
      "dot workspace-capture",
      "dot workspace-capture --current-workspace",
    ],
  },
  {
    name: "workspace-restore",
    summary: "Restore a captured Hyprland workspace session",
    usage: "[options]",
    description: [
      "Reuse, launch, move, and resize windows from a version 2 workspace capture.",
      "Application-specific launch policy can be supplied by the optional private overlay.",
    ],
    options: [
      {
        name: "--dry-run",
        description: "Print the restore plan without changing windows",
      },
      {
        name: "--file",
        valueName: "file",
        completion: "file",
        description: "Restore this capture file",
      },
      {
        name: "--state-dir",
        valueName: "dir",
        completion: "file",
        description: "Directory containing captures and restore.log",
      },
      {
        name: "--no-launch",
        description: "Do not launch missing supported apps",
      },
      {
        name: "--no-move",
        description: "Do not move or resize matched windows",
      },
      helpOption,
    ],
    examples: ["dot workspace-restore --dry-run", "dot workspace-restore"],
  },
  {
    name: "usage",
    summary: "Local-first analytics for dot usage",
    usage: "[summary|stale|path|backfill] [options]",
    description: [
      "Report local-first usage analytics for dot. Dispatched dot commands append",
      "NDJSON events under $XDG_STATE_HOME/tool-usage with timestamps, machine,",
      "canonical command, recognised flag names, exit status, duration, source,",
      "and invoker. Live dot events never store positional values.",
      "",
      "Optional shell-history backfill observes selected standalone tools without",
      "requiring integration. It uses whitespace tokenisation, so review the source",
      "history before applying when arguments may contain sensitive text.",
      "",
      "Set DOT_USAGE_DISABLE=1 to stop automatic live recording, or DOT_USAGE_DIR",
      "to relocate the event root. Explicit backfill --apply still writes events.",
    ],
    modes: [
      "summary    Per-feature usage table (default)",
      "stale      Features not used within the window",
      "path       Print the event storage root",
      "backfill   Import whitelisted invocations from shell history",
    ],
    options: [
      {
        name: "--days",
        valueName: "n",
        description: "Window for summary/stale (default: 90)",
      },
      {
        name: "--format",
        valueName: "fmt",
        description: "summary format",
        choices: [
          { value: "text" },
          { value: "json" },
          { value: "agent-context" },
        ],
      },
      {
        name: "--root",
        valueName: "path",
        completion: "file",
        description: "Extra event root to combine (repeatable)",
      },
      {
        name: "--history",
        description: "Backfill from shell history (accepted for clarity)",
      },
      {
        name: "--apply",
        description: "Write events during backfill (default: dry run)",
      },
      helpOption,
    ],
    examples: [
      "dot usage summary --days 30",
      "dot usage summary --format agent-context",
      "dot usage stale --days 90",
      "dot usage backfill --history",
      "dot usage backfill --history --apply",
    ],
  },
  {
    name: "help",
    summary: "Show this help menu",
    options: [helpOption],
  },
];

/** Top-level command names and aliases accepted by native dispatch. */
export const nativeCommandNames = new Set(
  cliCommands.flatMap((command) => [command.name, ...(command.aliases ?? [])]),
);

/** Return the command descriptor for a canonical name or alias. */
export function getCliCommand(name: string): CliCommandSpec | undefined {
  return cliCommands.find(
    (command) => command.name === name || command.aliases?.includes(name),
  );
}
