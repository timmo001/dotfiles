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
        description: "Init log path (default: /tmp/dot-init.log)",
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
    summary: "Pull repos, stow dotfiles, install deps, rebuild",
    options: [
      { name: "--pull", description: "Pull repos only" },
      { name: "--stow", description: "Stow only" },
      {
        name: "--tui",
        description: "Install deps and rebuild dot binary only",
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
      "All checks run in parallel. Results are printed per-section with a grouped",
      "summary at the end. A log file is always written to ~/.local/state/dot/logs/.",
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
          "Secret Service       kwallet vs gnome-keyring provider",
          "Repositories         Public/private dotfiles + private git repos exist and have upstreams",
          "Stow integrity       Dry-run restow to detect drift",
          "OpenCode location    Canonical paths, legacy remnants",
          "Git config           Managed include is active",
          "Workflow runs        Repo list, Waybar config, legacy watcher cleanup",
          "Git notifications    API scope and Waybar notification module wiring",
          "Doctor startup       Startup notification timer",
          "Daily volume reset   Laptop-only optional timer",
          "Omarchy repos        Diff repos + worktree branch correctness",
          "Browser flags        Symlinks from private stow package",
          "Hardware video       VAAPI render nodes, drivers, packages",
          "Browser extensions   Private extension check list",
          "Public packages      AUR packages installed + version check",
          "Private packages     Private repo + packages installed",
          "Pacman hooks         Hook files installed and up to date",
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
    name: "git-status",
    summary: "Show branch status for the current repository",
    usage: "[options]",
    description: [
      "Print unstaged files, staged files, and the last 10 commits — each with a",
      "compact relative timestamp, a pushed/local remote marker, and its changed",
      "files inline with (+added -deleted) line counts — for the current git",
      "repository. Designed as a single command for agents to get full",
      "working-tree and branch context.",
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
    ],
    modes: [
      "(default)       Status summary: unstaged, staged, recent commits",
      "--diff          Also print full unstaged and staged diffs",
      "--branch-diff   Also print the full diff vs the default branch",
    ],
    options: [
      {
        name: "--diff",
        description: "Append full unstaged and staged diffs for changed files",
      },
      {
        name: "--branch-diff",
        description:
          "Append the merge-base diff vs the default branch (errors on the default branch)",
      },
      helpOption,
    ],
    examples: [
      "dot git-status",
      "dot git-status --diff",
      "dot git-status --branch-diff",
      "dot git-status --diff --branch-diff",
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
          "Only include runs active at or after this date (ISO/RFC/epoch)",
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
      "Read, write, and delete note files. Writes and deletes are committed to the",
      "notes vault when possible.",
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
        summary: "Write stdin to a note file and commit it",
        options: [
          {
            name: "--path",
            valueName: "path",
            completion: "file",
            description: "Note file path",
          },
          { name: "--stdin", description: "Read note content from stdin" },
        ],
      },
      {
        name: "delete",
        summary: "Delete a note file and commit it",
        options: [
          {
            name: "--path",
            valueName: "path",
            completion: "file",
            description: "Note file path",
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
    summary: "Sync AGENTS.md to Cursor rule",
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
    usage: "[zsh] [--stdout]",
    description: [
      "Generate shell completions for dot.",
      "",
      "By default this writes the managed Zsh completion file in the public dotfiles",
      "repo so the next dot stow installs it to ~/.local/share/zsh/site-functions/_dot.",
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
        choices: [{ value: "zsh" }],
        completion: "shell",
      },
    ],
    examples: ["dot completions zsh", "dot completions zsh --stdout"],
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
