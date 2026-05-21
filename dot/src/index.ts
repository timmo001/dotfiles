import { Effect, Layer, Stream } from "effect";
import { createCliRenderer } from "@opentui/core";
import { Config } from "./services/Config.js";
import { CommandExecutor } from "./services/CommandExecutor.js";
import { OutputLog } from "./services/OutputLog.js";
import { Launcher } from "./services/Launcher.js";
import { DotDiff } from "./services/DotDiff.js";
import { WaybarCache } from "./services/WaybarCache.js";
import { RepoWatcher } from "./services/RepoWatcher.js";
import { GitStaging } from "./services/GitStaging.js";
import { CommitSuggest } from "./services/CommitSuggest.js";
import { shutdownServer } from "./services/OpenCodeServer.js";
import { createCommandRunner } from "./services/CommandRunner.js";
import { loadTheme } from "./theme.js";
import { Toast } from "./tui/Toast.js";
import { App } from "./tui/App.js";
import { resizeIfFloating } from "./tui/hyprland.js";
import { parseFlags, resolveSubcommand, printHelp } from "./flags.js";
import { menuItemsById } from "./menu.js";
import { bashFallback } from "./commands/BashFallback.js";
import type { ViewId } from "./types.js";

const log = (msg: string) => console.error(`[dot] ${msg}`);

// --- Parse CLI ---
const flags = parseFlags(process.argv.slice(2));

if (flags.help) {
  printHelp(flags.subcommand);
  process.exit(0);
}

// --- Determine execution mode ---
type Mode =
  | { type: "tui"; initialView: ViewId; executeItemId?: string }
  | { type: "fallback"; subcommand: string; args: readonly string[] };

function resolveMode(): Mode {
  if (!flags.subcommand) {
    // No subcommand: open TUI main menu
    return { type: "tui", initialView: "main" };
  }

  const resolved = resolveSubcommand(flags.subcommand);

  if (!resolved) {
    // Unknown subcommand — fall back to dot-legacy
    return {
      type: "fallback",
      subcommand: flags.subcommand.replace(/\./g, " "),
      args: flags.rest,
    };
  }

  if (resolved.type === "view") {
    return { type: "tui", initialView: resolved.viewId };
  }

  // Item resolved — check action type
  const item = menuItemsById.get(resolved.itemId);
  if (item) {
    const { action } = item;
    if (action.type === "view") {
      return { type: "tui", initialView: action.viewId };
    }
    if (action.type === "submenu") {
      return { type: "tui", initialView: "main", executeItemId: resolved.itemId };
    }
    // command, silent, notify — fall back to dot-legacy
    return {
      type: "fallback",
      subcommand: flags.subcommand!.replace(/\./g, " "),
      args: flags.rest,
    };
  }

  // Submenu key without a direct item — open in TUI
  return { type: "tui", initialView: "omarchy" };
}

const mode = resolveMode();

// --- Layer Composition ---

/** Minimal layers for CLI fallback commands (no renderer, no TUI services) */
const CliLayers = Launcher.cliLayer.pipe(
  Layer.provideMerge(OutputLog.cliLayer),
  Layer.provideMerge(CommandExecutor.layer),
  Layer.provideMerge(Config.layer),
);

// --- Execution ---

if (mode.type === "fallback") {
  // Run the legacy bash script for unported commands
  const program = bashFallback(mode.subcommand, mode.args).pipe(
    Effect.provide(CliLayers),
    Effect.catch(() =>
      Effect.sync(() => {
        process.exit(1);
      }),
    ),
  );

  Effect.runPromise(program).catch((err) => {
    log(`Fatal error: ${err}`);
    console.error(err);
    process.exit(1);
  });
} else {
  // TUI mode
  const { initialView, executeItemId } = mode;

  const tuiProgram = Effect.gen(function* () {
    log("Starting...");
    const watcher = yield* RepoWatcher;
    const gitStaging = yield* GitStaging;
    const commitSuggest = yield* CommitSuggest;
    const theme = yield* loadTheme;
    log("Services ready");

    log("Creating renderer...");
    const renderer = yield* Effect.promise(() =>
      createCliRenderer({
        exitOnCtrlC: true,
        screenMode: "alternate-screen",
        useMouse: false,
        backgroundColor: theme.transparent ? "transparent" : theme.bg,
        onDestroy: () => {
          shutdownServer();
          process.exit(0);
        },
      }),
    );
    log("Renderer created");

    const commandRunner = createCommandRunner(
      renderer,
      new Toast(renderer, theme),
    );

    // Create the app with concrete dependencies
    const app = new App(
      {
        renderer,
        theme,
        commandRunner,
        gitStaging,
        commitSuggest,
        onRefreshDiff: () => {
          Effect.runFork(watcher.refresh());
        },
      },
      {
        initialView,
        initialDiffTab: flags.tab,
        executeItemId,
      },
    );
    log("App created");

    const diffView = app.getDiffView();

    // Subscribe to watcher state changes and update the diff view
    yield* watcher.subscribe().pipe(
      Stream.runForEach((state) =>
        Effect.sync(() => {
          log(
            `State update: ${state.changed.length} changed, ${state.unchanged.length} unchanged`,
          );
          diffView.update(state);
        }),
      ),
      Effect.forkScoped,
    );
    log("Subscribed to state stream");

    // Push current state immediately for first paint
    const initialState = yield* watcher.getState();
    log(
      `Initial state: ${initialState.changed.length} changed, ${initialState.unchanged.length} unchanged`,
    );
    diffView.update(initialState);

    // Resize window if floating on Hyprland
    yield* resizeIfFloating(500, 600);

    log("Starting renderer...");
    renderer.start();
    log("Renderer started — TUI is live");

    // Keep alive until the process exits
    yield* Effect.never;
  });

  const TuiLayers = RepoWatcher.layer.pipe(
    Layer.provideMerge(DotDiff.layer),
    Layer.provideMerge(WaybarCache.layer),
    Layer.provideMerge(GitStaging.layer),
    Layer.provideMerge(CommitSuggest.layer),
  );

  const runnable = tuiProgram.pipe(Effect.scoped, Effect.provide(TuiLayers));

  log("Launching...");
  // Safety net: ensure OpenCode server is shut down if the process exits
  // without going through renderer.destroy() (e.g. uncaught exception).
  process.on("exit", shutdownServer);

  Effect.runPromise(runnable).catch((err) => {
    log(`Fatal error: ${err}`);
    console.error(err);
    process.exit(1);
  });
}
