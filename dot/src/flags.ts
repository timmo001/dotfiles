import type { ViewId } from "./types.js";
import { menuItemsById, submenus } from "./menu.js";

type DiffTab = "changed" | "unchanged";

/** Parsed CLI flags for `dot` */
export interface Flags {
  /** Resolved subcommand (dot-separated path) matching a menu item ID or view ID */
  readonly subcommand: string | undefined;
  /** Initial tab for the diff view */
  readonly tab: DiffTab;
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

/** Check whether a candidate string matches any known view, menu item, or submenu */
function isKnownTarget(candidate: string): boolean {
  if (
    candidate === "diff" ||
    candidate === "workflows" ||
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
 * The `tui` prefix is a transparent alias — `dot tui diff` is equivalent to
 * `dot diff`. It is stripped before subcommand resolution so remaining
 * positionals and flags are processed normally.
 */
export function parseFlags(args: readonly string[]): Flags {
  // Strip leading "tui" prefix — it's a no-op alias for the TUI entry point
  const effectiveArgs =
    args.length > 0 && args[0] === "tui" ? args.slice(1) : args;

  let subcommand: string | undefined;
  let tab: DiffTab = "changed";
  let help = false;
  const rest: string[] = [];

  let i = 0;

  // Collect all leading positional args (before any flags)
  const positionals: string[] = [];
  while (i < effectiveArgs.length && !effectiveArgs[i].startsWith("-")) {
    positionals.push(effectiveArgs[i]);
    i++;
  }

  // Greedy longest-match resolution for subcommand path
  if (positionals.length > 0) {
    let consumed = 0;
    // Try longest candidate first, shrink until a match is found
    for (let len = positionals.length; len >= 1; len--) {
      const candidate = positionals.slice(0, len).join(".");
      if (isKnownTarget(candidate)) {
        subcommand = candidate;
        consumed = len;
        break;
      }
    }
    if (consumed === 0) {
      // No match — use first positional (will fail in resolveSubcommand)
      subcommand = positionals[0];
      consumed = 1;
    }
    // Push unconsumed positionals to rest
    for (let j = consumed; j < positionals.length; j++) {
      rest.push(positionals[j]);
    }
  }

  // Parse remaining flags
  for (; i < effectiveArgs.length; i++) {
    const arg = effectiveArgs[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--tab") {
      const next = effectiveArgs[i + 1];
      if (!next || next.startsWith("-")) {
        console.error(
          "--tab requires a value (e.g. --tab changed or --tab other)",
        );
        process.exit(1);
      }
      tab = parseDiffTab(next);
      i++;
    } else {
      rest.push(arg);
    }
  }

  return { subcommand, tab, help, rest };
}

/** Resolve a subcommand string to a navigation target */
export function resolveSubcommand(
  sub: string,
):
  | { type: "view"; viewId: ViewId }
  | { type: "item"; itemId: string }
  | undefined {
  // Direct view names
  if (sub === "diff") return { type: "view", viewId: "diff" };
  if (sub === "workflows") return { type: "view", viewId: "workflows" };
  if (sub === "omarchy") return { type: "view", viewId: "omarchy" };

  // Match against menu item IDs or submenu keys
  if (menuItemsById.has(sub)) return { type: "item", itemId: sub };
  if (submenus.has(sub)) return { type: "item", itemId: sub };

  return undefined;
}

/**
 * Print help text, optionally scoped to a specific subcommand.
 *
 * - `diff` — shows diff-specific flags and keybindings
 * - `omarchy` — shows available omarchy submenus and space-separated navigation
 * - No subcommand — shows the full generic help
 */
export function printHelp(subcommand?: string): void {
  if (subcommand === "diff") {
    console.log(`Usage: dot diff [options]

Open the diff/repo watcher view. Without flags, opens the interactive TUI.

Modes:
  (default)        Interactive TUI diff view
  --raw            Coloured CLI summary of repos with changes
  --waybar         Single-line JSON for Waybar status module
  --list-changed   Pipe-delimited list of repos with changes (name|path)
  --list-all       Pipe-delimited list of all tracked repos (name|path)

Options:
  --no-fetch                       Skip fetching from remotes (use local refs only)
  --tab <changed|other|unchanged>  Initial pane to focus in TUI (default: changed)
  --help, -h                       Show this help message

Keybindings (TUI mode):
  ↑↓             Navigate the repo list
  Tab            Switch between Changed/Other pane
  Enter          Open lazygit for the selected repo
  c              Open commit flow (staging → commit)
  p              Pull selected repo
  P              Push selected repo
  t              Open tmux session for repos
  o              Open terminal in repo directory
  w              Open repo on GitHub
  r              Manual refresh
  Esc/Backspace  Back to main menu
  Ctrl+c         Quit

Examples:
  dot diff                 Interactive TUI
  dot diff --raw           CLI summary of changed repos
  dot diff --waybar        JSON for Waybar integration
  dot diff --tab other     TUI with Other pane focused`);
    return;
  }

  if (subcommand === "doctor") {
    console.log(`Usage: dot doctor [options]

Run health checks on the dotfiles system. Verifies dependencies, repos,
stow integrity, systemd timers, packages, browser config, and more.

All checks run in parallel. Results are printed per-section with a grouped
summary at the end. A log file is always written to ~/.local/state/dot/logs/.

Options:
  --open-opencode    Save report and launch an OpenCode session to analyse it
  --help, -h         Show this help message

Checks performed:
  Dependencies         Required/optional CLI tools (git, stow, gh, gum, ...)
  Secret Service       kwallet vs gnome-keyring provider
  Repositories         Public/private dotfiles + extra repos exist and have upstreams
  Stow integrity       Dry-run restow to detect drift
  OpenCode location    Canonical paths, legacy remnants
  Git config           Managed include is active
  Workflow watch       Hooks, timer, scripts, Waybar integration
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
  dot doctor --open-opencode  Run checks then hand off to OpenCode for analysis`);
    return;
  }

  if (subcommand === "workflows") {
    console.log(`Usage: dot workflows [options]

Open the watched GitHub workflow runs view. The left pane lists watched
repositories from the workflow-watch repo list. The right pane lists runs for
the selected repo's locally checked-out HEAD commit.

Options:
  --help, -h  Show this help message

Keybindings (TUI mode):
  ↑↓             Navigate the active pane
  Tab            Switch between Repos/Runs pane
  Enter          Focus runs from Repos, open selected run from Runs
  r              Refresh workflow runs
  Esc/Backspace  Back to main menu
  Ctrl+c         Quit

Examples:
  dot workflows          Interactive workflow runs TUI`);
    return;
  }

  if (subcommand === "omarchy" || subcommand?.startsWith("omarchy.")) {
    console.log(`Usage: dot omarchy [submenu...]

Open the Omarchy desktop controls menu. Submenus can be specified
as space-separated paths:

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
  diff                 Open the diff/repo watcher view
  workflows            Open watched GitHub workflow runs
  update               Run dot update
  stow                 Run dot stow
  doctor               Run dot doctor
  system-health        Run system-health-check
  skill-updates        Run dot skill-updates
  skill-check          Validate skill references
  topgrade             Run topgrade
  omarchy [submenu..]  Open the Omarchy submenu (space-separated paths)

Options:
  --help, -h                       Show this help message

Examples:
  dot                      Main menu
  dot diff                 Interactive diff TUI
  dot diff --raw           CLI diff summary
  dot diff --waybar        Waybar JSON output
  dot diff --tab other     Diff view, Other pane focused
  dot workflows            Watched workflow runs TUI
  dot omarchy theme        Omarchy theme submenu
  dot omarchy theme set    Execute omarchy theme set

Run 'dot <subcommand> --help' for subcommand-specific options.`);
}
