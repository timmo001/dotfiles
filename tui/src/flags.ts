type Pane = "changed" | "unchanged"

export interface Flags {
  tab: Pane
  help: boolean
}

function parseTabValue(value: string): Pane {
  if (value === "other" || value === "unchanged") return "unchanged"
  if (value === "changed") return "changed"
  console.error(`Unknown --tab value: ${value} (expected: changed, other)`)
  process.exit(1)
}

export function parseFlags(args: readonly string[]): Flags {
  let tab: Pane = "changed"
  let help = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--help" || arg === "-h") {
      help = true
    } else if (arg === "--tab") {
      const next = args[i + 1]
      if (!next || next.startsWith("-")) {
        console.error("--tab requires a value (e.g. --tab changed or --tab other)")
        process.exit(1)
      }
      tab = parseTabValue(next)
      i++
    } else {
      console.error(`Unknown flag: ${arg}`)
      process.exit(1)
    }
  }

  return { tab, help }
}
