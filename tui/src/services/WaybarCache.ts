import { Context, Effect, Layer } from "effect"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

/** Shape of the JSON written by the Waybar `dot-diff` module */
interface WaybarCacheData {
  /** Primary display text (e.g. repo count) */
  readonly text: string
  /** Tooltip with repository names (e.g. "Repositories with changes pending: dotfiles; notes") */
  readonly tooltip: string
  /** CSS class indicating change state (e.g. "dots-changed", "dots-ok", "dots-unknown") */
  readonly class: string
}

/** Service interface for reading the Waybar diff cache */
interface WaybarCacheService {
  /** Load and parse the Waybar cache JSON, returning null if unavailable */
  readonly load: () => Effect.Effect<WaybarCacheData | null, never>
  /** Extract changed repository names from the tooltip string */
  readonly parseChangedNames: (data: WaybarCacheData) => readonly string[]
}

/** Effect service tag for {@link WaybarCacheService} */
export class WaybarCache extends Context.Tag("WaybarCache")<
  WaybarCache,
  WaybarCacheService
>() {}

function getCachePath(): string {
  const cacheHome = process.env.XDG_CACHE_HOME || join(process.env.HOME || "~", ".cache")
  return join(cacheHome, "waybar", "dot-diff-waybar.json")
}

/** Live layer reading from `$XDG_CACHE_HOME/waybar/dot-diff-waybar.json` */
export const WaybarCacheLive = Layer.succeed(WaybarCache, {
  load: () =>
    Effect.tryPromise({
      try: async () => {
        const raw = await readFile(getCachePath(), "utf-8")
        const data = JSON.parse(raw) as WaybarCacheData
        if (!data.tooltip || !data.class) return null
        return data
      },
      catch: () => null as never,
    }).pipe(Effect.catchAll(() => Effect.succeed(null))),

  parseChangedNames: (data: WaybarCacheData): readonly string[] => {
    // Tooltip format: "Repositories with changes pending: dotfiles; notes"
    // or "Repositories with changes pending: dotfiles"
    const match = data.tooltip.match(/:\s*(.+)$/)
    if (!match) return []
    return match[1]
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean)
  },
})
