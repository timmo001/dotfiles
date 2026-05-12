import { Effect, Layer, Stream } from "effect"
import { createCliRenderer } from "@opentui/core"
import { DotDiffLive } from "./services/DotDiff.js"
import { WaybarCacheLive } from "./services/WaybarCache.js"
import { RepoWatcher, RepoWatcherLive } from "./services/RepoWatcher.js"
import { Dashboard } from "./tui/Dashboard.js"
import { openLazygit } from "./tui/Lazygit.js"
import { parseFlags, type Flags } from "./flags.js"

const log = (msg: string) => console.error(`[dot-tui] ${msg}`)

const flags = parseFlags(process.argv.slice(2))

if (flags.help) {
  console.log(`Usage: dot-tui [options]

Options:
  --tab <changed|other>  Initial tab to focus (default: changed)
  --help                 Show this help message`)
  process.exit(0)
}

const program = Effect.gen(function* () {
  log("Starting — resolving RepoWatcher service...")
  const watcher = yield* RepoWatcher
  log("RepoWatcher ready")

  log("Creating renderer...")
  const renderer = yield* Effect.promise(() =>
    createCliRenderer({
      exitOnCtrlC: true,
      screenMode: "alternate-screen",
      useMouse: false,
    }),
  )
  log("Renderer created")

  const dashboard = new Dashboard(renderer, {
    initialTab: flags.tab,
    onSelect: async (repo) => {
      await openLazygit(renderer, repo.path)
      Effect.runFork(watcher.refresh())
    },
    onRefresh: () => {
      Effect.runFork(watcher.refresh())
    },
  })
  log("Dashboard created")

  // Subscribe to watcher state changes and update dashboard
  yield* watcher.subscribe().pipe(
    Stream.runForEach((state) =>
      Effect.sync(() => {
        log(`State update: ${state.changed.length} changed, ${state.unchanged.length} unchanged`)
        dashboard.update(state)
      }),
    ),
    Effect.forkScoped,
  )
  log("Subscribed to state stream")

  // Also push current state immediately for first paint
  const initialState = yield* watcher.getState()
  log(`Initial state: ${initialState.changed.length} changed, ${initialState.unchanged.length} unchanged`)
  dashboard.update(initialState)

  // Set terminal tab title
  process.stdout.write("\x1b]0;Dot TUI\x07")

  log("Starting renderer...")
  renderer.start()
  log("Renderer started — TUI is live")

  // Keep alive until the process exits
  yield* Effect.never
})

const MainLayer = RepoWatcherLive.pipe(
  Layer.provideMerge(DotDiffLive),
  Layer.provideMerge(WaybarCacheLive),
)

const runnable = program.pipe(
  Effect.scoped,
  Effect.provide(MainLayer),
)

log("Launching...")
Effect.runPromise(runnable).catch((err) => {
  log(`Fatal error: ${err}`)
  console.error(err)
  process.exit(1)
})
