import type { ViewId } from "./types.js";
import { menuItemsById, submenus } from "./menu.js";

type DiffTab = "changed" | "unchanged";

/** Parsed CLI flags for `dot` */
export interface Flags {
  /** Resolved subcommand (dot-separated path) matching a menu item ID or view ID */
  readonly subcommand: string | undefined;
  /** Initial tab for the diff view */
  readonly tab: DiffTab;
  /** Normalized ISO timestamp for workflow run filters */
  readonly since: string | undefined;
  /** Show help and exit */
  readonly help: boolean;
  /** Remaining args not consumed by subcommand or flag parsing */
  readonly rest: readonly string[];
}

function parseDiffTab(value: string): DiffTab {
  if (value === "other" || value === "unchanged") return "unchanged";
  if (value === "changed") return "changed";
  console.error(
    `Unknown --tab value: ${value} (expected: changed, other, unchanged)`,
  );
  process.exit(1);
}

function parseSince(value: string): string {
  const trimmed = value.trim();
  const timestamp = parseSinceTimestamp(trimmed);

  if (!Number.isFinite(timestamp)) {
    console.error(
      `Unknown --since value: ${value} (expected an ISO/RFC date or epoch timestamp)`,
    );
    process.exit(1);
  }

  return new Date(timestamp).toISOString();
}

function parseSinceTimestamp(value: string): number {
  if (/^\d+$/.test(value)) return normalizeEpoch(Number(value));
  return Date.parse(value);
}

function normalizeEpoch(epoch: number): number {
  return epoch < 10_000_000_000 ? epoch * 1000 : epoch;
}

function stripTuiPrefix(args: readonly string[]): readonly string[] {
  return args.length > 0 && args[0] === "tui" ? args.slice(1) : args;
}

function collectLeadingPositionals(args: readonly string[]): {
  readonly positionals: readonly string[];
  readonly startIndex: number;
} {
  const positionals: string[] = [];
  let index = 0;

  while (index < args.length && !args[index].startsWith("-")) {
    positionals.push(args[index]);
    index++;
  }

  return { positionals, startIndex: index };
}

function findKnownTargetLength(positionals: readonly string[]): number {
  for (let len = positionals.length; len >= 1; len--) {
    if (isKnownTarget(positionals.slice(0, len).join("."))) return len;
  }

  return 0;
}

function resolvePositionals(positionals: readonly string[]): {
  readonly subcommand: string | undefined;
  readonly rest: readonly string[];
} {
  if (positionals.length === 0) return { subcommand: undefined, rest: [] };

  const consumed = findKnownTargetLength(positionals);
  const resolvedCount = consumed === 0 ? 1 : consumed;
  const subcommand = positionals.slice(0, resolvedCount).join(".");

  return { subcommand, rest: positionals.slice(resolvedCount) };
}

type ParsedOptions = {
  tab: DiffTab;
  since: string | undefined;
  help: boolean;
  rest: string[];
};

type FlagHandler = (
  args: readonly string[],
  index: number,
  parsed: ParsedOptions,
) => number;

function createParsedOptions(): ParsedOptions {
  return { tab: "changed", since: undefined, help: false, rest: [] };
}

function setHelp(
  _args: readonly string[],
  _index: number,
  parsed: ParsedOptions,
): number {
  parsed.help = true;
  return 0;
}

function consumeSinceEquals(
  args: readonly string[],
  index: number,
  parsed: ParsedOptions,
): number {
  parsed.since = parseSince(args[index].slice("--since=".length));
  return 0;
}

function consumeSinceOption(
  args: readonly string[],
  index: number,
  parsed: ParsedOptions,
): number {
  const values = collectFlagValues(args, index + 1);

  if (values.length === 0) {
    console.error("--since requires a date value");
    process.exit(1);
  }

  parsed.since = parseSince(values.join(" "));
  return values.length;
}

function consumeTabOption(
  args: readonly string[],
  index: number,
  parsed: ParsedOptions,
): number {
  const next = args[index + 1];

  if (!next || next.startsWith("-")) {
    console.error("--tab requires a value (e.g. --tab changed or --tab other)");
    process.exit(1);
  }

  parsed.tab = parseDiffTab(next);
  return 1;
}

function collectFlagValues(
  args: readonly string[],
  startIndex: number,
): string[] {
  const values: string[] = [];

  for (let index = startIndex; index < args.length; index++) {
    if (args[index].startsWith("--")) break;
    values.push(args[index]);
  }

  return values;
}

const flagHandlers = new Map<string, FlagHandler>([
  ["--help", setHelp],
  ["-h", setHelp],
  ["--since", consumeSinceOption],
  ["--tab", consumeTabOption],
]);

function parseOptions(
  args: readonly string[],
  startIndex: number,
): ParsedOptions {
  const parsed = createParsedOptions();

  for (let index = startIndex; index < args.length; index++) {
    const arg = args[index];
    const handler = arg.startsWith("--since=")
      ? consumeSinceEquals
      : flagHandlers.get(arg);

    if (!handler) {
      parsed.rest.push(arg);
      continue;
    }

    index += handler(args, index, parsed);
  }

  return parsed;
}

/** Check whether a candidate string matches any known view, menu item, or submenu */
function isKnownTarget(candidate: string): boolean {
  if (
    candidate === "diff" ||
    candidate === "git-diff" ||
    candidate === "git-workflows" ||
    candidate === "git-notifications" ||
    candidate === "notes" ||
    candidate === "note" ||
    candidate === "handoff" ||
    candidate === "handoffs" ||
    candidate === "init" ||
    candidate === "setup-private-repo" ||
    candidate === "private-pkg-publish" ||
    candidate === "omarchy"
  )
    return true;
  if (menuItemsById.has(candidate) || submenus.has(candidate)) return true;
  return false;
}

/**
 * Parse CLI args into structured flags with greedy subcommand resolution.
 *
 * Positional args are joined with `.` using greedy longest-match against
 * the menu registry. For example, `["omarchy", "theme", "set"]` resolves
 * to subcommand `"omarchy.theme.set"` if that ID exists in the registry.
 *
 * The `tui` prefix is a transparent alias — `dot tui git-diff` is equivalent to
 * `dot git-diff`. It is stripped before subcommand resolution so remaining
 * positionals and flags are processed normally.
 */
export function parseFlags(args: readonly string[]): Flags {
  const effectiveArgs = stripTuiPrefix(args);
  const { positionals, startIndex } = collectLeadingPositionals(effectiveArgs);
  const resolved = resolvePositionals(positionals);
  const parsed = parseOptions(effectiveArgs, startIndex);

  return {
    subcommand: resolved.subcommand,
    tab: parsed.tab,
    since: parsed.since,
    help: parsed.help,
    rest: [...resolved.rest, ...parsed.rest],
  };
}

/** Resolve a subcommand string to a navigation target */
export function resolveSubcommand(
  sub: string,
):
  | { type: "view"; viewId: ViewId }
  | { type: "item"; itemId: string }
  | undefined {
  // Direct view names. `diff` is a short alias for `git-diff`.
  if (sub === "git-diff" || sub === "diff") {
    return { type: "view", viewId: "git-diff" };
  }
  if (sub === "git-workflows") {
    return { type: "view", viewId: "git-workflows" };
  }
  if (sub === "git-notifications") {
    return { type: "view", viewId: "git-notifications" };
  }
  if (sub === "notes" || sub === "note") return undefined;
  if (sub === "omarchy") return { type: "view", viewId: "omarchy" };

  // Match against menu item IDs or submenu keys
  if (menuItemsById.has(sub)) return { type: "item", itemId: sub };
  if (submenus.has(sub)) return { type: "item", itemId: sub };

  return undefined;
}

/**
 * Print help text, optionally scoped to a specific subcommand.
 *
 * - `git-diff` — shows diff-specific flags
 * - `git-notifications` — shows GitHub inbox flags and actions
 * - `omarchy` — shows available omarchy submenus and space-separated navigation
 * - No subcommand — shows the full generic help
 */
export function printHelp(subcommand?: string): void {
  if (subcommand === "git-diff" || subcommand === "diff") {
    console.log(`Usage: dot git-diff [options]

Open the diff/repo watcher view. Without flags, opens the interactive TUI.

Modes:
  (default)        Interactive TUI diff view
  --raw            Text summary of repos with changes
  --bar-json      JSON output for status bars and shell modules
  --list-changed   Changed repos as name|path rows
  --list-all       All tracked repos as name|path rows

Options:
  --no-fetch                       Skip fetching from remotes (use local refs only)
  --tab <changed|other|unchanged>  Initial pane to focus in TUI (default: changed)
  --help, -h                       Show this help message

Examples:
  dot git-diff             Interactive TUI
  dot git-diff --raw       Text summary of changed repos
  dot git-diff --bar-json  Status bar JSON output
  dot git-diff --tab other TUI with Other pane focused`);
    return;
  }

  if (subcommand === "doctor") {
    console.log(`Usage: dot doctor [options]

Run health checks on the dotfiles system. Verifies dependencies, repos,
stow integrity, systemd timers, packages, browser config, and more.

All checks run in parallel. Results are printed per-section with a grouped
summary at the end. A log file is always written to ~/.local/state/dot/logs/.

Options:
  --open-opencode    Save report and open it in OpenCode
  --help, -h         Show this help message

Checks performed:
  Dependencies         Required/optional CLI tools (git, stow, gh, gum, ...)
  Secret Service       kwallet vs gnome-keyring provider
  Repositories         Public/private dotfiles + extra repos exist and have upstreams
  Stow integrity       Dry-run restow to detect drift
  OpenCode location    Canonical paths, legacy remnants
  Git config           Managed include is active
  Workflow runs        Repo list, Waybar config, legacy watcher cleanup
  Git notifications    API scope and Waybar notification module wiring
  Doctor startup       Startup notification timer
  Daily volume reset   Laptop-only optional timer
  Omarchy repos        Diff repos + worktree branch correctness
  Browser flags        Symlinks from private stow package
  Hardware video       VAAPI render nodes, drivers, packages
  Browser extensions   Private extension check list
  Public packages      AUR packages installed + version check
  Private packages     Private repo + packages installed
  Pacman hooks         Hook files installed and up to date

Exit codes:
  0    No critical errors (warnings may still be present)
  1    One or more critical errors found

Examples:
  dot doctor                  Run all checks
  dot doctor --open-opencode  Run checks, then open OpenCode with the report`);
    return;
  }

  if (subcommand === "init") {
    console.log(`Usage: dot init [options]

Run the one-time first-use setup workflow for a fresh machine. Init prepares
repos, packages, stow links, machine hooks, and then finishes by running
dot update. After init completes, use dot update for ongoing maintenance.

Options:
  --confirm                 Acknowledge non-interactive package helpers
  --noninteractive          Skip interactive prompts for this run
  --interactive             Allow interactive prompts for this run
  --branch <name>           Branch override for non-bootstrap Omarchy repos
  --bootstrap-branch <name> Branch override for bootstrap
  --help, -h                Show this help message

Examples:
  dot init --noninteractive --confirm
  dot init --branch main --bootstrap-branch distro/omarchy`);
    return;
  }

  if (subcommand === "setup-private-repo") {
    console.log(`Usage: dot setup-private-repo

Sync the private Arch package repo mirror, write the private pacman repo
snippet, and add the Include line to /etc/pacman.conf when it is missing.

This repairs Omarchy pacman.conf refreshes that remove local repository
includes. Privileged writes prefer pkexec and fall back to sudo.

Options:
  --help, -h  Show this help message

Examples:
  dot setup-private-repo`);
    return;
  }

  if (subcommand === "private-pkg-publish") {
    console.log(`Usage: dot private-pkg-publish [options] <package-name>

Build and publish a mapped private package into the private pacman repo.

Options:
  --no-git       Skip package repo commit and push
  --skip-build   Publish an existing dist package artifact
  --install      Install the published package after syncing the mirror
  --help, -h     Show this help message

Examples:
  dot private-pkg-publish twitch-notifications --install
  dot private-pkg-publish --skip-build --no-git twitch-notifications`);
    return;
  }

  if (subcommand === "git-workflows") {
    console.log(`Usage: dot git-workflows [options]

Open the watched GitHub workflow runs view. The left pane lists watched
repositories from the private repo list. The right pane lists runs for the
selected repo's locally checked-out HEAD commit.

Modes:
  (default)      Interactive workflow runs TUI
  --raw          Text summary of watched workflow runs
  --bar-json    JSON output for status bars and shell modules
  --list-repos   Watched repo summaries as rows
  --list-runs    Workflow runs as rows

Options:
  --since <date> Only include runs active at or after this date (ISO/RFC/epoch)
  --help, -h     Show this help message

Examples:
  dot git-workflows              Interactive workflow runs TUI
  dot git-workflows --raw        Text summary of watched workflow runs
  dot git-workflows --bar-json   Status bar JSON output
  dot git-workflows --since "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)"
  dot git-workflows --list-runs  List workflow runs`);
    return;
  }

  if (subcommand === "git-notifications") {
    console.log(`Usage: dot git-notifications [options]

Open the authenticated user's GitHub notification inbox. Without machine or
action flags, opens the interactive TUI.

Modes:
  (default)       Interactive notifications TUI
  --raw           Text summary of notification threads
  --bar-json     JSON output for status bars and shell modules
  --list-threads  Notification threads as rows

Filters:
  --all             Include read notifications
  --participating   Only include participating or mentioned threads
  --since <date>    Only include notifications updated after this date

Actions:
  --mark-read <id>  Mark a notification thread as read
  --mark-done <id>  Mark a notification thread as done
  --ignore <id>     Ignore future notifications for a thread
  --unignore <id>   Stop ignoring future notifications for a thread

Examples:
  dot git-notifications                    Interactive notifications TUI
  dot git-notifications --bar-json         Status bar JSON output
  dot git-notifications --participating    TUI with participating filter
  dot git-notifications --mark-read 12345  Mark thread read`);
    return;
  }

  if (subcommand === "notes") {
    console.log(`Usage: dot notes [--all] [command] [options]

Manage repository notes used by OpenCode note commands.

Modes:
  (default)                    Interactive notes TUI
  --all                        Interactive notes TUI across all repos

Commands:
  root                         Print the notes vault root
  root --repo-notes            Print the repository notes directory
  context --command <name>     Print the context block for OpenCode notes
  list [--all] [--format labels|json]
                               List notes for the current repository or all repos

Options:
  --all       Show notes from every repo-notes directory
  --help, -h  Show this help message

Examples:
  dot notes
  dot notes --all
  dot notes root
  dot notes context --command notes-list
  dot notes list --all
  dot notes list --format json`);
    return;
  }

  if (subcommand === "handoff" || subcommand === "handoffs") {
    console.log(`Usage: dot handoffs [--all]

Open the interactive notes TUI filtered to notes tagged handoff.

Aliases:
  dot handoff
  dot handoffs

Options:
  --all       Show handoff notes from every repo-notes directory
  --help, -h  Show this help message`);
    return;
  }

  if (subcommand === "note") {
    console.log(`Usage: dot note <command> [options]

Read, write, and delete note files. Writes and deletes are committed to the
notes vault when possible.

Commands:
  read --path <path>            Print a note file
  write --path <path> --stdin   Write stdin to a note file and commit it
  delete --path <path>          Delete a note file and commit it

Options:
  --help, -h  Show this help message

Examples:
  dot note read --path ~/Documents/notes/repo-notes/owner/repo/topic.md
  dot note write --path /tmp/notes/repo-notes/owner/repo/topic.md --stdin
  dot note delete --path /tmp/notes/repo-notes/owner/repo/topic.md`);
    return;
  }

  if (subcommand === "omarchy" || subcommand?.startsWith("omarchy.")) {
    console.log(`Usage: dot omarchy [submenu...]

Open the Omarchy desktop controls menu. Pass a submenu path to jump straight
to it:

  dot omarchy theme        Theme submenu
  dot omarchy theme set    Execute theme set directly

Available submenus:
  theme       Theme management
  font        Font management
  toggle      Toggle system features
  capture     Screenshots and recordings
  system      Lock, logout, reboot, shutdown
  launch      Launch applications
  refresh     Refresh system components
  restart     Restart system services
  install     Install software and tools
  remove      Remove software and features
  packages    Package management
  share       Share clipboard, files, folders
  reminder    Reminders
  setup       DNS, security setup
  snapshot    System snapshots
  brightness  Display and keyboard brightness
  power       Power profiles

Options:
  --help, -h  Show this help message`);
    return;
  }

  console.log(`Usage: dot [subcommand] [options]

Launch the dot TUI dashboard. Without a subcommand, opens the main menu.

Subcommands:
  git-diff             Open the git diff/repo watcher view
  git-workflows        Open watched GitHub workflow runs
  git-notifications    Open GitHub notification inbox
  notes                Open repository notes or run note utility commands
  handoffs             Open handoff notes
  handoff              Open handoff notes
  note                 Read, write, or delete note files
  update               Run dot update
  init                 Run one-time first-use machine setup
  stow                 Run dot stow
  doctor               Run dot doctor
  setup-private-repo   Register private pacman repo include
  private-pkg-publish  Build and publish a private package
  system-health        Run system-health-check
  skill-updates        Run dot skill-updates
  skill-check          Validate skill references
  topgrade             Run topgrade
  omarchy [submenu..]  Open an Omarchy submenu by path

Options:
  --help, -h                       Show this help message

Examples:
  dot                      Main menu
  dot git-diff             Interactive diff TUI
  dot git-diff --raw       Text diff summary
  dot git-diff --bar-json  Status bar JSON output
  dot git-workflows        Watched workflow runs TUI
  dot git-workflows --bar-json Status bar JSON output
  dot git-notifications    GitHub notifications TUI
  dot git-notifications --bar-json Status bar JSON output
  dot notes                Repository notes TUI
  dot handoffs             Handoff notes TUI
  dot notes root           Print notes vault root
  dot notes context --command notes-list
  dot init --noninteractive --confirm
  dot setup-private-repo Repair private pacman repo include
  dot private-pkg-publish twitch-notifications --install
  dot omarchy theme        Omarchy theme submenu
  dot omarchy theme set    Execute omarchy theme set

Run 'dot <subcommand> --help' for subcommand-specific options.`);
}
