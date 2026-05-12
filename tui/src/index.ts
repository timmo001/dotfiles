import { Effect, Layer, Stream } from "effect"
import { createCliRenderer } from "@opentui/core"
import { DotDiffLive } from "./services/DotDiff.js"
import { WaybarCacheLive } from "./services/WaybarCache.js"
import { RepoWatcher, RepoWatcherLive } from "./services/RepoWatcher.js"
import { GitStaging, GitStagingLive } from "./services/GitStaging.js"
import { CommitSuggest, CommitSuggestLive } from "./services/CommitSuggest.js"
import { shutdownServer } from "./services/CommitSuggest.js"
import { createCommandRunner } from "./services/CommandRunner.js"
import { App } from "./tui/App.js"
import { parseFlags, resolveSubcommand, printHelp } from "./flags.js"
import { menuItemsById } from "./menu.js"
import type { ViewId } from "./types.js"

const log = (msg: string) => console.error(`[dot-tui] ${msg}`)

const flags = parseFlags(process.argv.slice(2))

if (flags.help) {
  printHelp(flags.subcommand)
  process.exit(0)
}

// Resolve subcommand to determine startup behaviour
let initialView: ViewId = "main"
let executeItemId: string | undefined

if (flags.subcommand) {
  const resolved = resolveSubcommand(flags.subcommand)
  if (!resolved) {
    console.error(`Unknown subcommand: ${flags.subcommand}`)
    printHelp()
    process.exit(1)
  }

  if (resolved.type === "view") {
    initialView = resolved.viewId
  } else {
    const item = menuItemsById.get(resolved.itemId)
    if (item) {
      const { action } = item
      if (action.type === "command" || action.type === "silent" || action.type === "submenu") {
        executeItemId = resolved.itemId
      } else if (action.type === "view") {
        initialView = action.viewId
      }
    }
  }
}

const program = Effect.gen(function* () {
  log("Starting...")
  const watcher = yield* RepoWatcher
  const gitStaging = yield* GitStaging
  const commitSuggest = yield* CommitSuggest
  log("Services ready")

  log("Creating renderer...")
  const renderer = yield* Effect.promise(() =>
    createCliRenderer({
      exitOnCtrlC: true,
      screenMode: "alternate-screen",
      useMouse: false,
    }),
  )
  log("Renderer created")

  const commandRunner = createCommandRunner(renderer)

  // Create the app with concrete dependencies
  const app = new App(
    {
      renderer,
      commandRunner,
      gitStaging,
      commitSuggest,
      onRefreshDiff: () => {
        Effect.runFork(watcher.refresh())
      },
    },
    {
      initialView,
      initialDiffTab: flags.tab,
      executeItemId,
    },
  )
  log("App created")

  const diffView = app.getDiffView()

  // Subscribe to watcher state changes and update the diff view
  yield* watcher.subscribe().pipe(
    Stream.runForEach((state) =>
      Effect.sync(() => {
        log(`State update: ${state.changed.length} changed, ${state.unchanged.length} unchanged`)
        diffView.update(state)
      }),
    ),
    Effect.forkScoped,
  )
  log("Subscribed to state stream")

  // Push current state immediately for first paint
  const initialState = yield* watcher.getState()
  log(`Initial state: ${initialState.changed.length} changed, ${initialState.unchanged.length} unchanged`)
  diffView.update(initialState)

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
  Layer.provideMerge(GitStagingLive),
  Layer.provideMerge(CommitSuggestLive),
)

const runnable = program.pipe(
  Effect.scoped,
  Effect.provide(MainLayer),
)

log("Launching...")
// Ensure OpenCode server is shut down on exit if we started it
process.on("exit", shutdownServer)
process.on("SIGINT", () => { shutdownServer(); process.exit(0) })
process.on("SIGTERM", () => { shutdownServer(); process.exit(0) })

Effect.runPromise(runnable).catch((err) => {
  log(`Fatal error: ${err}`)
  console.error(err)
  process.exit(1)
})
