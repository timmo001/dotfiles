import { Effect, Layer, Stream } from "effect";
import { Config } from "./services/Config.js";
import { CommandExecutor } from "./services/CommandExecutor.js";
import { OutputLog } from "./services/OutputLog.js";
import { Launcher } from "./services/Launcher.js";
import { DotDiff } from "./git/services/DotDiff.js";
import { GitHub } from "./git/services/GitHub.js";
import { GitNotifications } from "./git/services/GitNotifications.js";
import { WorkflowRuns } from "./git/services/WorkflowRuns.js";
import { Notes } from "./notes/services/Notes.js";
import { parseFlags, resolveSubcommand, printHelp } from "./flags.js";
import { hasOption, optionValue } from "./lib/args.js";
import { menuItemsById } from "./menu.js";
import { stow } from "./commands/Stow.js";
import { update } from "./commands/Update.js";
import { doctor } from "./commands/Doctor.js";
import { help } from "./commands/Help.js";
import { clean } from "./commands/Clean.js";
import { agentsSync } from "./commands/AgentsSync.js";
import { opencodeDebug } from "./commands/OpencodeDebug.js";
import { init } from "./commands/Init.js";
import { install } from "./commands/Install.js";
import { setup } from "./commands/Setup.js";
import { setupPrivateRepo } from "./commands/SetupPrivateRepo.js";
import { privatePkgPublish } from "./commands/PrivatePkgPublish.js";
import { skillUpdates } from "./commands/SkillUpdates.js";
import { skillCheck } from "./commands/SkillCheck.js";
import { noteCommand, notesCommand } from "./notes/commands/Notes.js";
import {
  diffBarJson,
  diffListChanged,
  diffListAll,
  diffRaw,
} from "./git/commands/Diff.js";
import {
  workflowsListRepos,
  workflowsListRuns,
  workflowsRaw,
  workflowsBarJson,
} from "./git/commands/Workflows.js";
import {
  notificationsAction,
  notificationsListThreads,
  notificationsRaw,
  notificationsBarJson,
} from "./git/commands/Notifications.js";
import type {
  GitNotificationAction,
  GitNotificationQueryOptions,
  NotesViewFilter,
  ViewId,
  WorkflowRunQueryOptions,
} from "./types.js";

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
  | {
      type: "tui";
      initialView: ViewId;
      executeItemId?: string;
      initialNotesFilter?: NotesViewFilter;
    }
  | { type: "native"; command: string; args: readonly string[] };

const handoffNotesFilter = {
  tag: "handoff",
  title: "Handoffs",
} satisfies NotesViewFilter;
const allNotesFilter = {
  includeAllRepos: true,
} satisfies NotesViewFilter;

function includeAllRepos(filter: NotesViewFilter): NotesViewFilter {
  return { ...filter, includeAllRepos: true };
}

/** Commands ported natively to TypeScript Effect */
const nativeCommands = new Set([
  "stow",
  "update",
  "diff",
  "git-diff",
  "git-workflows",
  "git-notifications",
  "notes",
  "note",
  "handoff",
  "handoffs",
  "doctor",
  "help",
  "clean",
  "agents-sync",
  "opencode-debug",
  "init",
  "install",
  "setup",
  "setup-private-repo",
  "private-pkg-publish",
  "skill-updates",
  "skill-check",
]);

const NOTIFICATION_ACTION_FLAGS: readonly {
  readonly flag: string;
  readonly action: GitNotificationAction;
}[] = [
  { flag: "--mark-read", action: "read" },
  { flag: "--mark-done", action: "done" },
  { flag: "--ignore", action: "ignore" },
  { flag: "--unignore", action: "unignore" },
];

function resolveMode(): Mode {
  if (!flags.subcommand) {
    // No subcommand: open TUI main menu
    return { type: "tui", initialView: "main" };
  }

  // Native commands bypass the menu/fallback system entirely
  if (nativeCommands.has(flags.subcommand)) {
    if (flags.subcommand === "notes" && isNotesTuiInvocation(flags.rest)) {
      return flags.rest.includes("--all")
        ? {
            type: "tui",
            initialView: "notes",
            initialNotesFilter: allNotesFilter,
          }
        : { type: "tui", initialView: "notes" };
    }
    if (flags.subcommand === "handoff" || flags.subcommand === "handoffs") {
      const unsupported = flags.rest.filter((arg) => arg !== "--all");
      if (unsupported.length > 0) {
        console.error(`dot ${flags.subcommand} does not accept arguments`);
        console.error("Run 'dot handoffs --help' to see available commands.");
        process.exit(1);
      }
      return {
        type: "tui",
        initialView: "notes",
        initialNotesFilter: flags.rest.includes("--all")
          ? includeAllRepos(handoffNotesFilter)
          : handoffNotesFilter,
      };
    }
    // Git diff without machine flags opens the TUI diff view.
    if (flags.subcommand === "git-diff" || flags.subcommand === "diff") {
      const hasMachineFlag =
        hasBarJsonFlag(flags.rest) ||
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
        hasBarJsonFlag(flags.rest) ||
        flags.rest.includes("--list-repos") ||
        flags.rest.includes("--list-runs") ||
        flags.rest.includes("--raw");
      if (!hasMachineFlag) {
        return { type: "tui", initialView: "git-workflows" };
      }
    }
    // Git notifications without machine/action flags opens the TUI inbox view.
    if (flags.subcommand === "git-notifications") {
      if (!hasNotificationNativeFlag(flags.rest)) {
        return { type: "tui", initialView: "git-notifications" };
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
const notificationOpts = parseNotificationOpts(flags.rest, flags.since);

type NotificationActionService = {
  readonly refresh: (opts?: GitNotificationQueryOptions) => Effect.Effect<void>;
  readonly markRead: (threadId: string) => Effect.Effect<unknown, unknown>;
  readonly markDone: (threadId: string) => Effect.Effect<unknown, unknown>;
  readonly ignore: (threadId: string) => Effect.Effect<unknown, unknown>;
  readonly unignore: (threadId: string) => Effect.Effect<unknown, unknown>;
};

function parseNotificationOpts(
  args: readonly string[],
  since: string | undefined,
): GitNotificationQueryOptions | undefined {
  const all = args.includes("--all");
  const participating = args.includes("--participating");
  if (!all && !participating && !since) return undefined;
  return {
    ...(all && { all: true }),
    ...(participating && { participating: true }),
    ...(since && { since }),
  };
}

function hasNotificationNativeFlag(args: readonly string[]): boolean {
  return (
    hasBarJsonFlag(args) ||
    args.includes("--list-threads") ||
    args.includes("--raw") ||
    NOTIFICATION_ACTION_FLAGS.some(({ flag }) => hasOption(args, flag))
  );
}

function hasBarJsonFlag(args: readonly string[]): boolean {
  return args.includes("--bar-json");
}

function isNotesTuiInvocation(args: readonly string[]): boolean {
  return args.length === 0 || (args.length === 1 && args[0] === "--all");
}

function notificationActionArg(args: readonly string[]): {
  readonly action: GitNotificationAction;
  readonly threadId: string;
} | null {
  for (const { flag, action } of NOTIFICATION_ACTION_FLAGS) {
    if (!hasOption(args, flag)) continue;
    const threadId = optionValue(args, flag);
    if (!threadId) {
      console.error(`dot git-notifications ${flag} requires a thread ID`);
      process.exit(1);
    }
    return { action, threadId };
  }
  return null;
}

function runNotificationAction(
  notifications: NotificationActionService,
  action: GitNotificationAction,
  threadId: string,
  opts?: GitNotificationQueryOptions,
): Effect.Effect<void> {
  const actionEffect = (() => {
    switch (action) {
      case "read":
        return notifications.markRead(threadId);
      case "done":
        return notifications.markDone(threadId);
      case "ignore":
        return notifications.ignore(threadId);
      case "unignore":
        return notifications.unignore(threadId);
    }
  })();

  return actionEffect.pipe(
    Effect.flatMap(() => notifications.refresh(opts)),
    Effect.catch((error) =>
      Effect.sync(() => {
        log(`Notification action failed: ${String(error)}`);
      }).pipe(Effect.flatMap(() => notifications.refresh(opts))),
    ),
  );
}

type NativeEnv =
  | Config
  | CommandExecutor
  | DotDiff
  | GitHub
  | GitNotifications
  | Launcher
  | Notes
  | OutputLog
  | WorkflowRuns;
type NativeEffect = Effect.Effect<void, unknown, NativeEnv>;

// --- Layer Composition ---

/** Minimal layers for native CLI commands (no renderer, no TUI services) */
const CliLayers = Launcher.cliLayer.pipe(
  Layer.provideMerge(DotDiff.layer),
  Layer.provideMerge(WorkflowRuns.layer),
  Layer.provideMerge(GitNotifications.layer),
  Layer.provideMerge(Notes.layer),
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
    if (hasBarJsonFlag(args)) return diffBarJson(opts);
    if (args.includes("--list-changed")) return diffListChanged(opts);
    if (args.includes("--list-all")) return diffListAll;
    return diffRaw(opts);
  };

  const resolveWorkflows = (args: readonly string[]): NativeEffect => {
    if (hasBarJsonFlag(args)) return workflowsBarJson(workflowOpts);
    if (args.includes("--list-repos")) return workflowsListRepos(workflowOpts);
    if (args.includes("--list-runs")) return workflowsListRuns(workflowOpts);
    return workflowsRaw(workflowOpts);
  };

  const resolveNotifications = (args: readonly string[]): NativeEffect => {
    const action = notificationActionArg(args);
    if (action) return notificationsAction(action.action, action.threadId);
    if (hasBarJsonFlag(args)) return notificationsBarJson(notificationOpts);
    if (args.includes("--list-threads")) {
      return notificationsListThreads(notificationOpts);
    }
    return notificationsRaw(notificationOpts);
  };

  type NativeCommandHandler = (args: readonly string[]) => NativeEffect;
  const nativeCommandHandlers: Readonly<Record<string, NativeCommandHandler>> =
    {
      stow: (args) =>
        stow({
          publicOnly: args.includes("--public"),
          privateOnly: args.includes("--private"),
        }),
      update: (args) =>
        update({
          pull: args.includes("--pull"),
          stow: args.includes("--stow"),
          tui: args.includes("--tui"),
        }),
      "git-workflows": resolveWorkflows,
      "git-notifications": resolveNotifications,
      notes: notesCommand,
      note: noteCommand,
      doctor: (args) =>
        doctor({
          openOpencode: args.includes("--open-opencode"),
        }),
      help: () => help,
      clean: () => clean,
      "agents-sync": () => agentsSync,
      "opencode-debug": (args) => {
        const agentIdx = args.indexOf("--agent");
        const agent =
          agentIdx !== -1 && args[agentIdx + 1]
            ? (args[agentIdx + 1] as string)
            : undefined;
        return opencodeDebug({ agent });
      },
      init,
      install: () => install,
      setup: () => setup,
      "setup-private-repo": () => setupPrivateRepo,
      "private-pkg-publish": privatePkgPublish,
      "skill-updates": (args) =>
        skillUpdates({
          check: args.includes("--check"),
          update: args.includes("--update"),
          skipReview: args.includes("--skip-review"),
        }),
      "skill-check": (args) =>
        skillCheck({
          openOpencode: args.includes("--open-opencode"),
        }),
    };

  const resolveNative = (
    command: string,
    args: readonly string[],
  ): NativeEffect => {
    const handler = nativeCommandHandlers[command];
    if (handler) return handler(args);
    return Effect.sync(() => {
      console.error(`dot: unknown command '${command}'`);
      process.exit(1);
    });
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

  const { initialView, executeItemId, initialNotesFilter } = mode;

  const tuiProgram = Effect.gen(function* () {
    log("Starting...");
    const watcher = yield* RepoWatcher;
    const workflows = yield* WorkflowRuns;
    const notifications = yield* GitNotifications;
    const notes = yield* Notes;
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
        onRefreshNotifications: () => {
          Effect.runFork(notifications.refresh(notificationOpts));
        },
        onNotificationAction: (action, threadId) => {
          Effect.runFork(
            runNotificationAction(
              notifications,
              action,
              threadId,
              notificationOpts,
            ),
          );
        },
        listNotes: () => Effect.runPromise(notes.list()),
        listAllNotes: () => Effect.runPromise(notes.listAll()),
        readNote: (filePath) => Effect.runPromise(notes.read(filePath)),
        deleteNote: (filePath) => Effect.runPromise(notes.delete(filePath)),
        createNoteDraft: (kind, name, description) =>
          Effect.runPromise(notes.createDraft(kind, name, description)),
        finaliseNoteDraft: (filePath) =>
          Effect.runPromise(notes.finaliseDraft(filePath)).then(() => {}),
      },
      {
        initialView,
        initialDiffTab: flags.tab,
        executeItemId,
        initialNotesFilter,
      },
    );
    log("App created");

    const workflowsView = app.getWorkflowsView();
    const notificationsView = app.getNotificationsView();

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

    // Subscribe to notification state changes and update the notifications view
    yield* notifications.subscribe().pipe(
      Stream.runForEach((state) =>
        Effect.sync(() => {
          log(`Notification update: ${state.threads.length} threads`);
          notificationsView.update(state);
        }),
      ),
      Effect.forkScoped,
    );
    log("Subscribed to notification stream");

    // Push current state immediately for first paint
    const initialState = yield* watcher.getState();
    log(
      `Initial state: ${initialState.changed.length} changed, ${initialState.unchanged.length} unchanged`,
    );
    app.updateDiffState(initialState);

    const initialWorkflowState = yield* workflows.getState();
    workflowsView.update(initialWorkflowState);

    const initialNotificationState = yield* notifications.getState();
    notificationsView.update(initialNotificationState);

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
    Layer.provideMerge(GitNotifications.layer),
    Layer.provideMerge(Notes.layer),
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
