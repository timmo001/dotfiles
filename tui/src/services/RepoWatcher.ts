import { Context, Effect, Layer, PubSub, Schedule, Stream } from "effect"
import type { Repo, RepoState } from "../types.js"
import { DotDiff } from "./DotDiff.js"
import { WaybarCache } from "./WaybarCache.js"

const log = (msg: string) => console.error(`[dot-tui:Watcher] ${msg}`)

/** Service interface for the hybrid repo-polling watcher */
interface RepoWatcherService {
  /** Subscribe to a stream of repo state snapshots */
  readonly subscribe: () => Stream.Stream<RepoState>
  /** Trigger an immediate poll refresh */
  readonly refresh: () => Effect.Effect<void>
  /** Return the most recently polled state */
  readonly getState: () => Effect.Effect<RepoState>
}

/** Effect service tag for {@link RepoWatcherService} */
export class RepoWatcher extends Context.Tag("RepoWatcher")<
  RepoWatcher,
  RepoWatcherService
>() {}

function buildRepoState(
  all: readonly Repo[],
  changed: readonly Repo[],
): RepoState {
  const changedPaths = new Set(changed.map((r) => r.path))
  const unchanged = all.filter((r) => !changedPaths.has(r.path))
  return { changed, unchanged, lastChecked: new Date() }
}

/** Live layer: loads Waybar cache for fast first paint, then polls `dot diff` every 10 seconds */
export const RepoWatcherLive = Layer.scoped(
  RepoWatcher,
  Effect.gen(function* () {
    log("Initialising RepoWatcher...")
    const dotDiff = yield* DotDiff
    const waybarCache = yield* WaybarCache
    const pubsub = yield* PubSub.unbounded<RepoState>()

    let currentState: RepoState = {
      changed: [],
      unchanged: [],
      lastChecked: new Date(),
    }

    // Full poll: runs dot diff for both lists
    const poll = Effect.gen(function* () {
      log("Polling dot diff...")
      const [all, changed] = yield* Effect.all([
        dotDiff.listAll(),
        dotDiff.listChanged(),
      ], { concurrency: 2 })

      const state = buildRepoState(all, changed)
      currentState = state
      yield* PubSub.publish(pubsub, state)
      log(`Poll complete: ${changed.length} changed, ${state.unchanged.length} unchanged`)
    }).pipe(Effect.catchAll((error) => {
      log(`Poll failed: ${error}`)
      return Effect.logWarning(`Poll failed: ${error}`)
    }))

    // Fast startup: try Waybar cache first, then full poll
    const initialLoad = Effect.gen(function* () {
      log("Trying Waybar cache for fast start...")
      const cache = yield* waybarCache.load()

      if (cache && cache.class !== "dots-unknown") {
        const changedNames = waybarCache.parseChangedNames(cache)
        log(`Waybar cache hit: class=${cache.class}, changedNames=[${changedNames.join(", ")}]`)
        const all = yield* dotDiff.listAll().pipe(
          Effect.catchAll(() => Effect.succeed([] as readonly Repo[])),
        )

        if (all.length > 0) {
          const changedNameSet = new Set(changedNames)
          const changed = all.filter((r) => {
            const baseName = r.name.includes(":") ? r.name.split(":").pop()! : r.name
            return changedNameSet.has(baseName) || changedNameSet.has(r.name)
          })
          const state = buildRepoState(all, changed)
          currentState = state
          yield* PubSub.publish(pubsub, state)
          log(`Fast start: ${changed.length} changed, ${state.unchanged.length} unchanged`)
          return
        }
      }

      log("Waybar cache miss — falling back to full poll")
      yield* poll
    }).pipe(Effect.catchAll(() => {
      log("Initial load error — falling back to full poll")
      return poll
    }))

    // Run initial load
    yield* initialLoad
    log("Initial load complete")

    // Start background poll fiber (10s interval, matching lazygit)
    yield* poll.pipe(
      Effect.repeat(Schedule.spaced("10 seconds")),
      Effect.forkScoped,
    )
    log("Background poll started (10s interval)")

    return {
      subscribe: () => Stream.fromPubSub(pubsub),
      refresh: () => poll,
      getState: () => Effect.succeed(currentState),
    }
  }),
)
