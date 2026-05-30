import { Context, Effect, Layer } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Shape of the JSON written by the Waybar `git-diff` module */
interface GitDiffWaybarCacheData {
  /** Primary display text (e.g. repo count) */
  readonly text: string;
  /** Tooltip with repository names (e.g. "Repositories with changes pending: dotfiles; notes") */
  readonly tooltip: string;
  /** CSS class indicating change state (e.g. "dots-changed", "dots-ok", "dots-unknown") */
  readonly class: string;
}

/** Service interface for reading the Waybar git diff cache */
interface GitDiffWaybarCacheService {
  /** Load and parse the Waybar cache JSON, returning null if unavailable */
  readonly load: () => Effect.Effect<GitDiffWaybarCacheData | null, never>;
  /** Extract changed repository names from the tooltip string */
  readonly parseChangedNames: (
    data: GitDiffWaybarCacheData,
  ) => readonly string[];
}

/** Effect service for {@link GitDiffWaybarCacheService} */
export class GitDiffWaybarCache extends Context.Service<
  GitDiffWaybarCache,
  GitDiffWaybarCacheService
>()("GitDiffWaybarCache") {
  static readonly layer = Layer.succeed(GitDiffWaybarCache, {
    load: () =>
      Effect.tryPromise({
        try: async () => {
          const raw = await readFile(getCachePath(), "utf-8");
          const data = JSON.parse(raw) as GitDiffWaybarCacheData;
          if (!data.tooltip || !data.class) return null;
          return data;
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }).pipe(Effect.catch(() => Effect.succeed(null))),

    parseChangedNames: (data: GitDiffWaybarCacheData): readonly string[] => {
      // Tooltip format: "Repositories with changes pending: dotfiles; notes"
      // or "Repositories with changes pending: dotfiles"
      const match = data.tooltip.match(/:\s*(.+)$/);
      if (!match) return [];
      return match[1]
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    },
  });
}

function getCachePath(): string {
  const cacheHome =
    process.env.XDG_CACHE_HOME || join(process.env.HOME || "~", ".cache");
  return join(cacheHome, "waybar", "git-diff-waybar.json");
}
