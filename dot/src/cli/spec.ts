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

const allNotesOption = {
  name: "--all",
  description: "Show notes from every repo-notes directory",
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
  description: "Run checks then open OpenCode analysis",
} satisfies CliOptionSpec;

const omarchySubmenuChoices: readonly CliValueChoice[] = [
  { value: "theme", description: "Theme management" },
  { value: "font", description: "Font management" },
  { value: "toggle", description: "Toggle system features" },
  { value: "capture", description: "Screenshots and recordings" },
  { value: "system", description: "Lock, logout, reboot, shutdown" },
  { value: "launch", description: "Launch applications" },
  { value: "refresh", description: "Refresh system components" },
  { value: "restart", description: "Restart system services" },
  { value: "install", description: "Install software and tools" },
  { value: "remove", description: "Remove software and features" },
  { value: "packages", description: "Package management" },
  { value: "share", description: "Share clipboard, files, folders" },
  { value: "reminder", description: "Reminders" },
  { value: "setup", description: "DNS, security setup" },
  { value: "snapshot", description: "System snapshots" },
  { value: "brightness", description: "Display and keyboard brightness" },
  { value: "power", description: "Power profiles" },
];

/** Top-level native `dot` command descriptors. */
export const cliCommands: readonly CliCommandSpec[] = [
  {
    name: "dashboard",
    summary: "Open the dot dashboard",
    usage: "[options]",
    description: [
      "Open the full-screen dot dashboard. It combines tracked repo",
      "state, GitHub notifications, workflow runs, and optional bounded source",
      "commands for Twitch, environment, and calendar cards.",
    ],
    modes: ["(default)      Interactive dashboard"],
    options: [helpOption],
    examples: ["dot dashboard"],
  },
  {
    name: "init",
    summary: "Run one-time first-use machine setup",
    usage: "[options]",
    description: [
      "Run the one-time first-use setup workflow for a fresh machine. Init prepares",
      "repos, stow links, mise tools, packages, machine hooks, and then finishes by",
      "running dot update. After init completes, use dot update for ongoing maintenance.",
    ],
    options: [
      {
        name: "--confirm",
        description: "Acknowledge non-interactive package helpers",
      },
      {
        name: "--noninteractive",
        description: "Skip interactive prompts for this run",
      },
      {
        name: "--interactive",
        description: "Allow interactive prompts for this run",
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
        choices: [
          { value: "desktop", description: "Desktop Hypr host" },
          { value: "laptop", description: "Laptop Hypr host" },
        ],
      },
      {
        name: "--log",
        valueName: "path",
        completion: "file",
        description: "Init log path (default: ~/.local/state/dot/init.log)",
      },
      {
        name: "--branch",
        valueName: "name",
        description: "Branch override for non-bootstrap Omarchy repos",
      },
      {
        name: "--bootstrap-branch",
        valueName: "name",
        description: "Branch override for bootstrap",
      },
      helpOption,
    ],
    examples: [
      "dot init --noninteractive --confirm",
      "dot init --host laptop --noninteractive --confirm",
      "dot init --force --noninteractive --confirm",
      "dot init --branch main --bootstrap-branch distro/omarchy",
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
    summary: "Pull repos, stow dotfiles, install deps, rebuild",
    options: [
      { name: "--pull", description: "Pull repos only" },
      { name: "--stow", description: "Stow only" },
      {
        name: "--tui",
        description: "Install deps and rebuild dot binary only",
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
        description: "Save report and open it in OpenCode",
      },
      helpOption,
    ],
    sections: [
      {
        title: "Checks performed",
        lines: [
          "Dependencies         Required/optional CLI tools (git, stow, gh, gum, ...)",
          "gh extensions        Configured gh CLI extensions are installed",
          "Repositories         Public/private dotfiles + private git repos exist and have upstreams",
          "Origin HEAD          Local origin/HEAD tracks the remote default branch (not stale)",
          "Stow integrity       Dry-run restow to detect drift",
          "OpenCode location    Canonical paths, legacy remnants",
          "Git config           Managed include is active",
          "Workflow runs        Repo list, status bar config, legacy watcher cleanup",
          "Git notifications    API scope and status bar notification module wiring",
          "Doctor startup       Startup notification timer",
          "Daily volume reset   Laptop-only optional timer",
          "Omarchy repos        Diff repos + worktree branch correctness",
          "Legacy Hypr repo     Flags a retired omarchy-hypr clone at ~/.config/hypr",
          "Neovim theme link    Repairs a mislocated omarchy-nvim theme.lua symlink",
          "Browser flags        Symlinks from private stow package",
          "Hardware video       VAAPI render nodes, drivers, packages",
          "Browser extensions   Private extension check list",
          "Public packages      AUR packages installed + version check",
          "Private packages     Private repo + packages installed",
          "Pacman hooks         Hook files installed and up to date",
          "Firewall rules       Managed ufw ports (KDE Connect, Home Assistant, OpenCode)",
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
    summary: "Open the git diff/repo watcher view",
    usage: "[options]",
    description: [
      "Open the diff/repo watcher view. Without flags, opens the interactive TUI.",
    ],
    modes: [
      "(default)        Interactive TUI diff view",
      "--raw            Text summary of repos with changes",
      "--bar-json      JSON output for status bars and shell modules",
      "--list-changed   Changed repos as name|path rows",
      "--list-all       All tracked repos as name|path rows",
    ],
    options: [
      {
        name: "--no-fetch",
        description: "Skip fetching from remotes (use local refs only)",
      },
      {
        name: "--tab",
        valueName: "tab",
        description: "Initial pane to focus in TUI (default: changed)",
        choices: [
          { value: "changed" },
          { value: "other" },
          { value: "unchanged" },
        ],
      },
      rawOption,
      barJsonOption,
      { name: "--list-changed", description: "Changed repos as rows" },
      { name: "--list-all", description: "All tracked repos as rows" },
      helpOption,
    ],
    examples: [
      "dot git-diff",
      "dot git-diff --raw",
      "dot git-diff --bar-json",
      "dot git-diff --tab other",
    ],
  },
  {
    name: "git-context",
    summary: "Show branch context for the current repository",
    usage: "[options]",
    description: [
      "Print branch context for the current git repository: repository root,",
      "branch/base header, HEAD, ahead/behind state, the pull request for the",
      "branch (on a feature branch), unstaged, staged, untracked, and branch changed",
      "files, and the larger of today's commits or the last 10 commits — each with a",
      "compact relative timestamp, a pushed/local remote marker, and its changed files",
      "inline with (+added -deleted) line counts. Designed as a single command for",
      "agents to get full working-tree and branch context, and as the shared producer",
      "for the OpenCode branch-context plugin (via --json).",
      "",
      "On a feature branch the pull request summary is always shown: number, state,",
      "title, comment count, review decision, mergeability, draft state, branches,",
      "and URL, plus the description. It is resilient and omitted when gh is",
      "missing, no PR exists, or the request fails. Add --comments, --reviews,",
      "--labels, or --checks to include those sections; --checks makes a second gh",
      "call. Use --remotes when remote fetch/push URLs are needed. Use",
      "--no-description or --no-pr to trim the PR block.",
      "",
      "Substitutes running these separately: git status, git diff --stat /",
      "git diff --numstat, git diff --cached --stat, git log --oneline --stat,",
      "and git log @{upstream}..HEAD (ahead/pushed check).",
      "",
      "Add --diff to append the full unstaged and staged diffs under their",
      "sections, and --branch-diff to append the full diff of the current branch",
      "against the default branch (measured from their merge base so committed",
      "and uncommitted changes both show). --branch-diff errors on the default",
      "branch, where that range is empty. The flags combine.",
      "",
      "Use --json to emit the structured branch-context payload (consumed by the",
      "OpenCode branch-context plugin) instead of text. The --no-* section flags",
      "control which blocks the payload carries.",
      "",
      "Use --since <date> to override the default recent-commit window on the",
      "default branch or when the default branch ref cannot be resolved. Git accepts",
      "relative values such as '2d' / '2 days ago' and absolute dates.",
    ],
    modes: [
      "(default)       Context summary: repo, branch, PR, status, branch files, commits",
      "--json          Emit the structured branch-context payload",
      "--diff          Also print full unstaged and staged diffs",
      "--branch-diff   Also print the full diff vs the default branch",
      "--remotes       Also include remote fetch/push URLs",
      "--since <date>  Show recent commits since a date instead of the default window",
    ],
    options: [
      {
        name: "--json",
        description:
          "Emit the structured branch-context payload (plugin format) instead of text",
      },
      {
        name: "--comments",
        description: "Include pull request conversation comments",
      },
      {
        name: "--reviews",
        description: "Include individual pull request reviews",
      },
      {
        name: "--labels",
        description: "Include pull request labels",
      },
      {
        name: "--checks",
        description: "Include CI check runs (makes a second gh call)",
      },
      {
        name: "--no-description",
        description: "Omit the pull request description",
      },
      {
        name: "--no-pr",
        description: "Omit the pull request block entirely",
      },
      {
        name: "--remotes",
        description: "Include remote fetch/push URLs in the branch metadata",
      },
      {
        name: "--no-branch-metadata",
        description: "Omit the branch metadata block",
      },
      {
        name: "--no-status",
        description: "Omit the working-tree status block",
      },
      {
        name: "--no-work-scope",
        description: "Omit the branch work-scope block",
      },
      {
        name: "--diff",
        description: "Append full unstaged and staged diffs for changed files",
      },
      {
        name: "--branch-diff",
        description:
          "Append the merge-base diff vs the default branch (errors on the default branch)",
      },
      {
        name: "--since",
        valueName: "date",
        description:
          "Show recent commits since this date or relative duration on the default/recent path",
      },
      helpOption,
    ],
    examples: [
      "dot git-context",
      "dot git-context --comments --reviews",
      "dot git-context --labels --checks",
      "dot git-context --remotes",
      "dot git-context --diff",
      "dot git-context --branch-diff",
      "dot git-context --json",
      'dot git-context --since "2 days ago"',
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
    name: "git-log",
    summary: "Open recent commits across tracked repos",
    usage: "[options]",
    description: [
      "Open the recent commit history view. The left pane lists tracked repositories",
      "from dot git-diff, sorted by latest commit activity. The right pane lists recent",
      "commits for the selected repository.",
    ],
    modes: [
      "(default)      Interactive git log TUI",
      "--raw          Text summary of recent commits",
    ],
    options: [
      { ...rawOption, description: "Text summary of recent commits" },
      helpOption,
    ],
    examples: ["dot git-log", "dot git-log --raw"],
  },
  {
    name: "git-workflows",
    summary: "Open watched GitHub workflow runs",
    usage: "[options]",
    description: [
      "Open the watched GitHub workflow runs view. The left pane lists watched",
      "repositories from the private repo list. The right pane lists runs for the",
      "selected repo's locally checked-out HEAD commit.",
    ],
    modes: [
      "(default)      Interactive workflow runs TUI",
      "--raw          Text summary of watched workflow runs",
      "--bar-json    JSON output for status bars and shell modules",
      "--list-repos   Watched repo summaries as rows",
      "--list-runs    Workflow runs as rows",
    ],
    options: [
      {
        name: "--since",
        valueName: "date",
        description:
          "Only include runs active at or after this date (ISO/RFC/epoch/relative duration)",
      },
      { ...rawOption, description: "Text summary of watched workflow runs" },
      barJsonOption,
      { name: "--list-repos", description: "Watched repo summaries as rows" },
      { name: "--list-runs", description: "Workflow runs as rows" },
      helpOption,
    ],
    examples: [
      "dot git-workflows",
      "dot git-workflows --raw",
      "dot git-workflows --bar-json",
      "dot git-workflows --since \"$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)\"",
      "dot git-workflows --list-runs",
    ],
  },
  {
    name: "git-notifications",
    summary: "Open GitHub notification inbox",
    usage: "[options]",
    description: [
      "Open the authenticated user's GitHub notification inbox. Without machine or",
      "action flags, opens the interactive TUI.",
    ],
    modes: [
      "(default)       Interactive notifications TUI",
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
        description: "Ignore future notifications for a thread",
      },
      {
        name: "--unignore",
        valueName: "id",
        description: "Stop ignoring future notifications for a thread",
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
    name: "notes",
    summary: "Open repository notes or run note utility commands",
    usage: "[--all] [command] [options]",
    description: ["Manage repository notes used by OpenCode note commands."],
    modes: [
      "(default)                    Interactive notes TUI",
      "--all                        Interactive notes TUI across all repos",
    ],
    commands: [
      {
        name: "root",
        summary: "Print the notes vault root",
        options: [
          {
            name: "--repo-notes",
            description: "Print repository notes directory",
          },
        ],
      },
      {
        name: "context",
        summary: "Print the context block for OpenCode notes",
        options: [
          {
            name: "--command",
            valueName: "name",
            description: "OpenCode command name",
          },
        ],
      },
      {
        name: "list",
        summary: "List repository notes",
        options: [
          allNotesOption,
          {
            name: "--format",
            valueName: "labels|json",
            description: "Output format",
            choices: [{ value: "labels" }, { value: "json" }],
          },
        ],
      },
    ],
    options: [allNotesOption, helpOption],
    examples: [
      "dot notes",
      "dot notes --all",
      "dot notes root",
      "dot notes context --command notes-list",
      "dot notes list --all",
      "dot notes list --format json",
    ],
  },
  {
    name: "handoffs",
    aliases: ["handoff"],
    summary: "Open handoff notes",
    usage: "[--all] [--list]",
    description: [
      "Open the interactive notes TUI filtered to notes tagged handoff.",
      "Use --list for a plain text listing without the TUI.",
    ],
    sections: [{ title: "Aliases", lines: ["dot handoff", "dot handoffs"] }],
    options: [
      {
        name: "--all",
        description: "Show handoff notes from every repo-notes directory",
      },
      {
        name: "--list",
        description: "List handoff notes to stdout without opening the TUI",
      },
      helpOption,
    ],
  },
  {
    name: "note",
    summary: "Read, write, or delete note files",
    usage: "<command> [options]",
    description: [
      "Read, write, and delete note files. Writes and deletes are committed and",
      "pushed to the notes vault when possible.",
    ],
    commands: [
      {
        name: "read",
        summary: "Print a note file",
        options: [
          {
            name: "--path",
            valueName: "path",
            completion: "file",
            description: "Note file path",
          },
        ],
      },
      {
        name: "write",
        summary: "Write stdin to a note file, then commit and push it",
        options: [
          {
            name: "--path",
            valueName: "path",
            completion: "file",
            description: "Note file path",
          },
          { name: "--stdin", description: "Read note content from stdin" },
          {
            name: "--json",
            description: "Emit the note output and push status as JSON",
          },
        ],
      },
      {
        name: "delete",
        summary: "Delete a note file, then commit and push it",
        options: [
          {
            name: "--path",
            valueName: "path",
            completion: "file",
            description: "Note file path",
          },
          {
            name: "--json",
            description: "Emit the note output and push status as JSON",
          },
        ],
      },
    ],
    options: [helpOption],
    examples: [
      "dot note read --path ~/Documents/notes/repo-notes/owner/repo/topic.md",
      "dot note write --path /tmp/notes/repo-notes/owner/repo/topic.md --stdin",
      "dot note delete --path /tmp/notes/repo-notes/owner/repo/topic.md",
    ],
  },
  {
    name: "agents-sync",
    summary:
      "Mirror AGENTS.md to agent harness instruction files",
    options: [helpOption],
  },
  {
    name: "opencode-debug",
    summary: "Debug OpenCode config and paths",
    options: [
      {
        name: "--agent",
        valueName: "name",
        description: "Debug a specific OpenCode agent",
      },
      helpOption,
    ],
  },
  {
    name: "mcp",
    summary: "Run the dot MCP server over stdio",
    description: [
      "Start a Model Context Protocol server that exposes the notes vault and",
      "read-only repository context to any MCP-capable agent harness.",
      "",
      "The server speaks JSON-RPC over stdio and is meant to be launched by an",
      "MCP client, not run interactively. Mutating note actions emit a desktop",
      "notification. All logging goes to stderr so stdout stays protocol-clean.",
    ],
    options: [helpOption],
    examples: ["dot mcp"],
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
    name: "setup-private-repo",
    summary: "Register private pacman repo include",
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
      { name: "--skip-review", description: "Skip local-edit review" },
      helpOption,
    ],
  },
  {
    name: "skill-check",
    summary: "Validate skill references",
    options: [
      openOpencodeOption,
      {
        name: "--diff-origin",
        description:
          "Diff imported skills against their upstream origins; with --open-opencode, include the diff in the prompt",
      },
      helpOption,
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
    name: "omarchy",
    summary: "Open an Omarchy submenu by path",
    usage: "[submenu...]",
    description: [
      "Open the Omarchy desktop controls menu. Pass a submenu path to jump straight",
      "to it:",
      "",
      "  dot omarchy theme        Theme submenu",
      "  dot omarchy theme set    Execute theme set directly",
    ],
    sections: [
      {
        title: "Available submenus",
        lines: omarchySubmenuChoices.map((choice) =>
          `${choice.value.padEnd(11)} ${choice.description ?? ""}`.trimEnd(),
        ),
      },
    ],
    arguments: [
      {
        name: "submenu",
        choices: omarchySubmenuChoices,
        repeatable: true,
      },
    ],
    options: [helpOption],
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
