import { Effect, Layer, Stream } from "effect";
import { Config } from "./services/Config.js";
import { CommandExecutor } from "./services/CommandExecutor.js";
import { OutputLog } from "./services/OutputLog.js";
import { Launcher } from "./services/Launcher.js";
import { DotDiff } from "./git/services/DotDiff.js";
import { GitHub } from "./git/services/GitHub.js";
import { WorkflowRuns } from "./git/services/WorkflowRuns.js";
import { parseFlags, resolveSubcommand, printHelp } from "./flags.js";
import { menuItemsById } from "./menu.js";
import { stow } from "./commands/Stow.js";
import { update } from "./commands/Update.js";
import { doctor } from "./commands/Doctor.js";
import { help } from "./commands/Help.js";
import { clean } from "./commands/Clean.js";
import { agentsSync } from "./commands/AgentsSync.js";
import { opencodeDebug } from "./commands/OpencodeDebug.js";
import { install } from "./commands/Install.js";
import { setup } from "./commands/Setup.js";
import { skillUpdates } from "./commands/SkillUpdates.js";
import { skillCheck } from "./commands/SkillCheck.js";
import {
  diffWaybar,
  diffListChanged,
  diffListAll,
  diffRaw,
} from "./git/commands/Diff.js";
import {
  workflowsListRepos,
  workflowsListRuns,
  workflowsRaw,
  workflowsWaybar,
} from "./git/commands/Workflows.js";
import type { ViewId, WorkflowRunQueryOptions } from "./types.js";

const DEBUG = !!process.env.DOT_DEBUG;
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot] ${msg}`);
};

// --- Parse CLI ---
const flags = parseFlags(process.argv.slice(2));

if (flags.help) {
  printHelp(flags.subcommand);
  process.exit(0);
}

// --- Determine execution mode ---
type Mode =
  | { type: "tui"; initialView: ViewId; executeItemId?: string }
  | { type: "native"; command: string; args: readonly string[] };

/** Commands ported natively to TypeScript Effect */
const nativeCommands = new Set([
  "stow",
  "update",
  "diff",
  "git-diff",
  "git-workflows",
  "doctor",
  "help",
  "clean",
  "agents-sync",
  "opencode-debug",
  "install",
  "setup",
  "skill-updates",
  "skill-check",
]);

function resolveMode(): Mode {
  if (!flags.subcommand) {
    // No subcommand: open TUI main menu
    return { type: "tui", initialView: "main" };
  }

  // Native commands bypass the menu/fallback system entirely
  if (nativeCommands.has(flags.subcommand)) {
    // Git diff without machine flags opens the TUI diff view.
    if (flags.subcommand === "git-diff" || flags.subcommand === "diff") {
      const hasMachineFlag =
        flags.rest.includes("--waybar") ||
        flags.rest.includes("--list-changed") ||
        flags.rest.includes("--list-all") ||
        flags.rest.includes("--raw");
      if (!hasMachineFlag) {
        return { type: "tui", initialView: "git-diff" };
      }
    }
    // Git workflows without machine/listing flags opens the TUI workflows view.
    if (flags.subcommand === "git-workflows") {
      const hasMachineFlag =
        flags.rest.includes("--waybar") ||
        flags.rest.includes("--list-repos") ||
        flags.rest.includes("--list-runs") ||
        flags.rest.includes("--raw");
      if (!hasMachineFlag) {
        return { type: "tui", initialView: "git-workflows" };
      }
    }
    return { type: "native", command: flags.subcommand, args: flags.rest };
  }

  const resolved = resolveSubcommand(flags.subcommand);

  if (!resolved) {
    console.error(`dot: unknown command '${flags.subcommand}'`);
    console.error("Run 'dot --help' to see available commands.");
    process.exit(1);
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
      return {
        type: "tui",
        initialView: "main",
        executeItemId: resolved.itemId,
      };
    }
    // command, silent, notify items are only runnable from the TUI
    console.error(`dot: unknown command '${flags.subcommand}'`);
    console.error("Run 'dot --help' to see available commands.");
    process.exit(1);
  }

  // Submenu key without a direct item — open in TUI
  return { type: "tui", initialView: "omarchy" };
}

const mode = resolveMode();
const workflowOpts: WorkflowRunQueryOptions | undefined = flags.since
  ? { since: flags.since }
  : undefined;

type NativeEnv =
  | Config
  | CommandExecutor
  | DotDiff
  | GitHub
  | Launcher
  | OutputLog
  | WorkflowRuns;
type NativeEffect = Effect.Effect<void, unknown, NativeEnv>;

// --- Layer Composition ---

/** Minimal layers for native CLI commands (no renderer, no TUI services) */
const CliLayers = Launcher.cliLayer.pipe(
  Layer.provideMerge(DotDiff.layer),
  Layer.provideMerge(WorkflowRuns.layer),
  Layer.provideMerge(GitHub.layer),
  Layer.provideMerge(OutputLog.cliLayer),
  Layer.provideMerge(CommandExecutor.layer),
  Layer.provideMerge(Config.layer),
);

// --- Execution ---

if (mode.type === "native") {
  // Run a natively-ported command with CLI layers
  const resolveDiff = (args: readonly string[]): NativeEffect => {
    const noFetch = args.includes("--no-fetch");
    const opts = noFetch ? { noFetch: true } : undefined;
    if (args.includes("--waybar")) return diffWaybar(opts);
    if (args.includes("--list-changed")) return diffListChanged(opts);
    if (args.includes("--list-all")) return diffListAll;
    return diffRaw(opts);
  };

  const resolveWorkflows = (args: readonly string[]): NativeEffect => {
    if (args.includes("--waybar")) return workflowsWaybar(workflowOpts);
    if (args.includes("--list-repos")) return workflowsListRepos(workflowOpts);
    if (args.includes("--list-runs")) return workflowsListRuns(workflowOpts);
    return workflowsRaw(workflowOpts);
  };

  const resolveNative = (
    command: string,
    args: readonly string[],
  ): NativeEffect => {
    switch (command) {
      case "stow":
        return stow({
          publicOnly: args.includes("--public"),
          privateOnly: args.includes("--private"),
        });
      case "update":
        return update({
          pull: args.includes("--pull"),
          stow: args.includes("--stow"),
          tui: args.includes("--tui"),
        });
      case "git-workflows":
        return resolveWorkflows(args);
      case "doctor":
        return doctor({
          openOpencode: args.includes("--open-opencode"),
        });
      case "help":
        return help;
      case "clean":
        return clean;
      case "agents-sync":
        return agentsSync;
      case "opencode-debug": {
        const agentIdx = args.indexOf("--agent");
        const agent =
          agentIdx !== -1 && args[agentIdx + 1]
            ? (args[agentIdx + 1] as string)
            : undefined;
        return opencodeDebug({ agent });
      }
      case "install":
        return install;
      case "setup":
        return setup;
      case "skill-updates":
        return skillUpdates({
          check: args.includes("--check"),
          update: args.includes("--update"),
          skipReview: args.includes("--skip-review"),
        });
      case "skill-check":
        return skillCheck({
          openOpencode: args.includes("--open-opencode"),
        });
      default:
        return Effect.sync(() => {
          console.error(`dot: unknown command '${command}'`);
          process.exit(1);
        });
    }
  };

  const program =
    mode.command === "git-diff" || mode.command === "diff"
      ? resolveDiff(mode.args).pipe(Effect.provide(CliLayers))
      : resolveNative(mode.command, mode.args).pipe(
          Effect.provide(CliLayers),
          Effect.catch((err: unknown) =>
            Effect.sync(() => {
              console.error(err);
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
  // TUI mode — dynamically import TUI dependencies to avoid loading the
  // OpenTUI native library on CLI-only paths (each dlopen copies ~8MB to /tmp).
  const { extractNativeLibIfNeeded } =
    await import("./lib/extractNativeLib.js");
  const nativeLibPath = await extractNativeLibIfNeeded();

  const { Renderer } = await import("./services/Renderer.js");
  const { Toast } = await import("./services/Toast.js");
  const { GitDiffWaybarCache } =
    await import("./git/services/GitDiffWaybarCache.js");
  const { RepoWatcher } = await import("./git/services/RepoWatcher.js");
  const { GitStaging } = await import("./git/services/GitStaging.js");
  const { CommitSuggest } = await import("./git/services/CommitSuggest.js");
  const { shutdownServer } = await import("./services/OpenCodeServer.js");
  const { createCommandRunner } = await import("./services/CommandRunner.js");
  const { loadTheme } = await import("./theme.js");
  const { App } = await import("./tui/App.js");
  const { resizeIfFloating } = await import("./tui/hyprland.js");

  const { initialView, executeItemId } = mode;

  const tuiProgram = Effect.gen(function* () {
    log("Starting...");
    const watcher = yield* RepoWatcher;
    const workflows = yield* WorkflowRuns;
    const gitStaging = yield* GitStaging;
    const commitSuggest = yield* CommitSuggest;
    const renderer = yield* Renderer;
    const toast = yield* Toast;
    log("Services ready");

    const commandRunner = createCommandRunner(renderer, toast);

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
        onRefreshWorkflows: () => {
          Effect.runFork(workflows.refresh(workflowOpts));
        },
      },
      {
        initialView,
        initialDiffTab: flags.tab,
        executeItemId,
      },
    );
    log("App created");

    const workflowsView = app.getWorkflowsView();

    // Subscribe to watcher state changes and update the diff view
    yield* watcher.subscribe().pipe(
      Stream.runForEach((state) =>
        Effect.sync(() => {
          log(
            `State update: ${state.changed.length} changed, ${state.unchanged.length} unchanged`,
          );
          app.updateDiffState(state);
        }),
      ),
      Effect.forkScoped,
    );
    log("Subscribed to state stream");

    // Subscribe to workflow state changes and update the workflows view
    yield* workflows.subscribe().pipe(
      Stream.runForEach((state) =>
        Effect.sync(() => {
          log(`Workflow update: ${state.repos.length} watched repos`);
          workflowsView.update(state);
        }),
      ),
      Effect.forkScoped,
    );
    log("Subscribed to workflow stream");

    // Push current state immediately for first paint
    const initialState = yield* watcher.getState();
    log(
      `Initial state: ${initialState.changed.length} changed, ${initialState.unchanged.length} unchanged`,
    );
    app.updateDiffState(initialState);

    const initialWorkflowState = yield* workflows.getState();
    workflowsView.update(initialWorkflowState);

    // Resize window if floating on Hyprland
    yield* resizeIfFloating(500, 600);

    log("Starting renderer...");
    renderer.start();
    log("Renderer started — TUI is live");

    // Keep alive until the process exits
    yield* Effect.never;
  });

  // Resolve theme synchronously (uses readFileSync, no async deps)
  const theme = Effect.runSync(loadTheme);

  const TuiLayers = RepoWatcher.layer.pipe(
    Layer.provideMerge(WorkflowRuns.layer),
    Layer.provideMerge(DotDiff.layer),
    Layer.provideMerge(GitHub.layer),
    Layer.provideMerge(GitDiffWaybarCache.layer),
    Layer.provideMerge(GitStaging.layer),
    Layer.provideMerge(CommitSuggest.layer),
    Layer.provideMerge(Toast.layer(theme)),
    Layer.provideMerge(Renderer.layer(theme, nativeLibPath)),
    Layer.provideMerge(CommandExecutor.layer),
    Layer.provideMerge(Config.layer),
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
