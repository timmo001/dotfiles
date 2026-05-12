import type { ViewId } from "./types.js"
import { menuItemsById } from "./menu.js"

type DiffTab = "changed" | "unchanged"

export interface Flags {
  /** Subcommand matching a menu item ID, or a view ID like "diff" */
  subcommand: string | undefined
  /** Initial tab for the diff view */
  tab: DiffTab
  /** Show help and exit */
  help: boolean
  /** Remaining args to pass through to the subcommand */
  rest: readonly string[]
}

function parseDiffTab(value: string): DiffTab {
  if (value === "other" || value === "unchanged") return "unchanged"
  if (value === "changed") return "changed"
  console.error(`Unknown --tab value: ${value} (expected: changed, other)`)
  process.exit(1)
}

export function parseFlags(args: readonly string[]): Flags {
  let subcommand: string | undefined
  let tab: DiffTab = "changed"
  let help = false
  const rest: string[] = []

  let i = 0

  // First positional arg is the subcommand (if it doesn't start with -)
  if (i < args.length && !args[i].startsWith("-")) {
    subcommand = args[i]
    i++
  }

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

/** Resolve a subcommand string to a target: either a view to open or a menu item ID */
export function resolveSubcommand(sub: string): { type: "view"; viewId: ViewId } | { type: "item"; itemId: string } | undefined {
  // Direct view names
  if (sub === "diff") return { type: "view", viewId: "diff" }
  if (sub === "omarchy") return { type: "view", viewId: "omarchy" }

  // Match against menu item IDs
  if (menuItemsById.has(sub)) return { type: "item", itemId: sub }

  // Try with omarchy prefix for convenience (e.g. "theme" → "omarchy.theme")
  const withPrefix = `omarchy.${sub}`
  if (menuItemsById.has(withPrefix)) return { type: "item", itemId: withPrefix }

  return undefined
}

export function printHelp(): void {
  console.log(`Usage: dot-tui [subcommand] [options]

Launch the dot TUI dashboard. Without a subcommand, opens the main menu.

Subcommands:
  diff                 Open the diff/repo watcher view
  update               Run dot update (suspend/resume)
  stow                 Run dot stow (background)
  doctor               Run dot doctor (suspend/resume)
  system-health        Run system-health-check (suspend/resume)
  skill-updates        Run dot skill-updates (suspend/resume)
  memory               Run dot memory (background)
  topgrade             Run topgrade (suspend/resume)
  omarchy              Open the Omarchy submenu
  omarchy.<sub>        Open an Omarchy sub-submenu (e.g. omarchy.theme)

Options:
  --tab <changed|other>  Initial tab for the diff view (default: changed)
  --help, -h             Show this help message`)
}
