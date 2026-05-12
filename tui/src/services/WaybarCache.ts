import { Context, Effect, Layer } from "effect"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

interface WaybarCacheData {
  readonly text: string
  readonly tooltip: string
  readonly class: string
}

interface WaybarCacheService {
  readonly load: () => Effect.Effect<WaybarCacheData | null, never>
  readonly parseChangedNames: (data: WaybarCacheData) => readonly string[]
}

export class WaybarCache extends Context.Tag("WaybarCache")<
  WaybarCache,
  WaybarCacheService
>() {}

function getCachePath(): string {
  const cacheHome = process.env.XDG_CACHE_HOME || join(process.env.HOME || "~", ".cache")
  return join(cacheHome, "waybar", "dot-diff-waybar.json")
}

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
