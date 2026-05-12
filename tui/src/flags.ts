import type { ViewId } from "./types.js"
import { menuItemsById, submenus } from "./menu.js"

type DiffTab = "changed" | "unchanged"

/** Parsed CLI flags for `dot-tui` */
export interface Flags {
  /** Resolved subcommand (dot-separated path) matching a menu item ID or view ID */
  readonly subcommand: string | undefined
  /** Initial tab for the diff view */
  readonly tab: DiffTab
  /** Show help and exit */
  readonly help: boolean
  /** Remaining args not consumed by subcommand or flag parsing */
  readonly rest: readonly string[]
}

function parseDiffTab(value: string): DiffTab {
  if (value === "other" || value === "unchanged") return "unchanged"
  if (value === "changed") return "changed"
  console.error(`Unknown --tab value: ${value} (expected: changed, other, unchanged)`)
  process.exit(1)
}

/** Check whether a candidate string matches any known view, menu item, or submenu */
function isKnownTarget(candidate: string): boolean {
  if (candidate === "diff" || candidate === "omarchy") return true
  if (menuItemsById.has(candidate) || submenus.has(candidate)) return true
  return false
}

/**
 * Parse CLI args into structured flags with greedy subcommand resolution.
 *
 * Positional args are joined with `.` using greedy longest-match against
 * the menu registry. For example, `["omarchy", "theme", "set"]` resolves
 * to subcommand `"omarchy.theme.set"` if that ID exists in the registry.
 */
export function parseFlags(args: readonly string[]): Flags {
  let subcommand: string | undefined
  let tab: DiffTab = "changed"
  let help = false
  const rest: string[] = []

  let i = 0

  // Collect all leading positional args (before any flags)
  const positionals: string[] = []
  while (i < args.length && !args[i].startsWith("-")) {
    positionals.push(args[i])
    i++
  }

  // Greedy longest-match resolution for subcommand path
  if (positionals.length > 0) {
    let consumed = 0
    // Try longest candidate first, shrink until a match is found
    for (let len = positionals.length; len >= 1; len--) {
      const candidate = positionals.slice(0, len).join(".")
      if (isKnownTarget(candidate)) {
        subcommand = candidate
        consumed = len
        break
      }
    }
    if (consumed === 0) {
      // No match — use first positional (will fail in resolveSubcommand)
      subcommand = positionals[0]
      consumed = 1
    }
    // Push unconsumed positionals to rest
    for (let j = consumed; j < positionals.length; j++) {
      rest.push(positionals[j])
    }
  }

  // Parse remaining flags
  for (; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--help" || arg === "-h") {
      help = true
    } else if (arg === "--tab") {
      const next = args[i + 1]
      if (!next || next.startsWith("-")) {
        console.error("--tab requires a value (e.g. --tab changed or --tab other)")
        process.exit(1)
      }
      tab = parseDiffTab(next)
      i++
    } else {
      rest.push(arg)
    }
  }

  return { subcommand, tab, help, rest }
}

/** Resolve a subcommand string to a navigation target */
export function resolveSubcommand(sub: string): { type: "view"; viewId: ViewId } | { type: "item"; itemId: string } | undefined {
  // Direct view names
  if (sub === "diff") return { type: "view", viewId: "diff" }
  if (sub === "omarchy") return { type: "view", viewId: "omarchy" }

  // Match against menu item IDs or submenu keys
  if (menuItemsById.has(sub)) return { type: "item", itemId: sub }
  if (submenus.has(sub)) return { type: "item", itemId: sub }

  return undefined
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
    console.log(`Usage: dot-tui diff [options]

Open the diff/repo watcher view.

Options:
  --tab <changed|other|unchanged>  Initial pane to focus (default: changed)
  --help, -h                       Show this help message

Keybindings:
  ↑↓             Navigate the repo list
  Tab            Switch between Changed/Other pane
  Enter          Open lazygit for the selected repo
  r              Manual refresh
  Esc/Backspace  Back to main menu
  q              Quit`)
    return
  }

  if (subcommand === "omarchy" || subcommand?.startsWith("omarchy.")) {
    console.log(`Usage: dot-tui omarchy [submenu...]

Open the Omarchy desktop controls menu. Submenus can be specified
as space-separated paths:

  dot-tui omarchy theme        Theme submenu
  dot-tui omarchy theme set    Execute theme set directly

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
  --help, -h  Show this help message`)
    return
  }

  console.log(`Usage: dot-tui [subcommand] [options]

Launch the dot TUI dashboard. Without a subcommand, opens the main menu.

Subcommands:
  diff                 Open the diff/repo watcher view
  update               Run dot update
  stow                 Run dot stow
  doctor               Run dot doctor
  system-health        Run system-health-check
  skill-updates        Run dot skill-updates
  memory               Run dot memory
  topgrade             Run topgrade
  omarchy [submenu..]  Open the Omarchy submenu (space-separated paths)

Options:
  --tab <changed|other|unchanged>  Initial tab for the diff view (default: changed)
  --help, -h                       Show this help message

Examples:
  dot-tui                      Main menu
  dot-tui diff --tab other     Diff view, Other pane focused
  dot-tui omarchy theme        Omarchy theme submenu
  dot-tui omarchy theme set    Execute omarchy theme set`)
}
