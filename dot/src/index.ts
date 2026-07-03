import { Effect, Layer, Stream } from "effect";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { Config } from "./services/Config.js";
import { CommandExecutor } from "./services/CommandExecutor.js";
import { OutputLog } from "./services/OutputLog.js";
import { Launcher } from "./services/Launcher.js";
import { DotDiff } from "./git/services/DotDiff.js";
import { GitLog } from "./git/services/GitLog.js";
import { GitHub } from "./git/services/GitHub.js";
import { GitNotifications } from "./git/services/GitNotifications.js";
import { GitStaging } from "./git/services/GitStaging.js";
import { WorkflowRuns } from "./git/services/WorkflowRuns.js";
import { Dashboard } from "./dashboard/services/Dashboard.js";
import { buildDashboardState } from "./dashboard/viewModel.js";
import { Notes } from "./notes/services/Notes.js";
import { parseFlags, resolveSubcommand, printHelp } from "./flags.js";
import { hasOption, optionValue, optionValues } from "./lib/args.js";
import {
  bootstrapGhRepoClone,
  bootstrapGitPullRebase,
  bootstrapGitRepoExists,
  ghAuthenticated,
} from "./lib/bootstrapGit.js";
import { isGvfsPath, writeMirroredLog } from "./lib/logMirror.js";
import { CONFIG_DIR, STATE_DIR, expandHomePath } from "./lib/paths.js";
import { ENV, envString, setEnv, unsetEnv } from "./lib/env.js";
import { detectAgent } from "./lib/agent.js";
import { menuItemsById } from "./menu.js";
import { init } from "./commands/Init.js";
import { install } from "./commands/Install.js";
import { update, updateCheck } from "./commands/Update.js";
import { stow } from "./commands/Stow.js";
import { doctor } from "./commands/Doctor.js";
import { clean } from "./commands/Clean.js";
import { agentsSync } from "./commands/AgentsSync.js";
import { opencodeDebug } from "./commands/OpencodeDebug.js";
import { mcpCommand } from "./mcp/commands/Mcp.js";
import { isAgentCommand } from "./commands/IsAgent.js";
import { setupPrivateRepo } from "./commands/SetupPrivateRepo.js";
import { privatePkgPublish } from "./commands/PrivatePkgPublish.js";
import { skillUpdates } from "./commands/SkillUpdates.js";
import { skillCheck } from "./commands/SkillCheck.js";
import { completions } from "./commands/Completions.js";
import { help } from "./commands/Help.js";
import { noteCommand, notesCommand } from "./notes/commands/Notes.js";
import { handoffsList } from "./notes/commands/Handoffs.js";
import {
  diffBarJson,
  diffListChanged,
  diffListAll,
  diffRaw,
} from "./git/commands/Diff.js";
import { gitLogRaw } from "./git/commands/Log.js";
import { gitStatusRaw } from "./git/commands/Status.js";
import { gitCommitRaw } from "./git/commands/Commit.js";
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
  notificationsMarkBotRead,
} from "./git/commands/Notifications.js";
import type {
  GitNotificationAction,
  GitNotificationQueryOptions,
  NotesViewFilter,
  ViewId,
  WorkflowRunQueryOptions,
} from "./types.js";
import { getCliCommand, nativeCommandNames } from "./cli/spec.js";

const DEBUG = !!envString(ENV.DOT_DEBUG);
const DEFAULT_INIT_LOG_FILE = join(STATE_DIR, "dot", "init.log");
const PRIVATE_DOTFILES_REPO = "timmo001/dotfiles-private";
const UPDATE_DISABLE_SELF_UPDATE_ARG = "--no-self-update";
const UPDATE_POST_HOOK_REPO_ARG = "--post-hook-repo";
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

const NOTIFICATION_ACTION_FLAGS: readonly {
  readonly flag: string;
  readonly action: GitNotificationAction;
}[] = [
  { flag: "--mark-read", action: "read" },
  { flag: "--mark-done", action: "done" },
  { flag: "--ignore", action: "ignore" },
  { flag: "--unignore", action: "unignore" },
];

/**
 * Machine-readable command to suggest when an interactive view is blocked under
 * an agent or a non-interactive stdout. Views without an entry are TUI-only.
 */
const TUI_ALTERNATIVES: Partial<Record<ViewId, string>> = {
  main: "dot help",
  dashboard: "dot git-status",
  "git-diff": "dot git-diff --raw",
  "git-log": "dot git-log --raw",
  "git-workflows": "dot git-workflows --raw",
  "git-notifications": "dot git-notifications --raw",
  notes: "dot notes list",
};

/**
 * Refuse to open the interactive TUI when dot is driven by an AI agent or when
 * stdout is not a terminal, pointing at a machine-readable command instead.
 * `DOT_AGENT=0` forces the TUI back on when a real terminal is attached.
 */
function guardInteractiveMode(current: Mode): void {
  if (current.type !== "tui") return;

  const nonTty = !process.stdout.isTTY;
  const detection = detectAgent();
  if (!nonTty && !detection.isAgent) return;

  const reason = nonTty
    ? "stdout is not an interactive terminal"
    : `an AI agent (${detection.name}) is driving dot`;
  const alternative = TUI_ALTERNATIVES[current.initialView];
  const guidance = alternative
    ? `Run \`${alternative}\` for machine-readable output.`
    : `The ${current.initialView} view is interactive-only with no machine-readable equivalent.`;
  const forceHint = nonTty ? "" : " Set DOT_AGENT=0 to open the TUI anyway.";

  console.error(`dot: not opening the interactive TUI (${reason}).`);
  console.error(`${guidance}${forceHint}`);
  process.exit(1);
}

function resolveMode(): Mode {
  if (!flags.subcommand) {
    // No subcommand: open TUI main menu
    return { type: "tui", initialView: "main" };
  }

  // Native commands bypass the menu/fallback system entirely
  if (nativeCommandNames.has(flags.subcommand)) {
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
      if (flags.rest.includes("--list")) {
        return {
          type: "native",
          command: "handoffs",
          args: flags.rest,
        };
      }
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
    if (flags.subcommand === "dashboard") {
      return { type: "tui", initialView: "dashboard" };
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
    // Git log without raw output opens the TUI git log view.
    if (flags.subcommand === "git-log") {
      if (!flags.rest.includes("--raw")) {
        return { type: "tui", initialView: "git-log" };
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
guardInteractiveMode(mode);

function initLogPath(args: readonly string[]): string {
  return expandHomePath(
    optionValue(args, "--log") ??
      envString(ENV.DOT_INIT_LOG_FILE) ??
      DEFAULT_INIT_LOG_FILE,
  );
}

function appendBootstrapLog(message: string | Uint8Array): void {
  const logFile = envString(ENV.DOT_LOG_FILE);
  if (!logFile) return;
  writeMirroredLog(logFile, message);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return typeof error === "string" ? error : JSON.stringify(error, null, 2);
}

function configureInitLogging(mode: Mode): void {
  if (mode.type !== "native" || mode.command !== "init") return;
  if (mode.args.includes("--help") || mode.args.includes("-h")) return;

  const requestedLogFile = initLogPath(mode.args);
  setEnv(
    ENV.DOT_LOG_FILE,
    isGvfsPath(requestedLogFile) ? DEFAULT_INIT_LOG_FILE : requestedLogFile,
  );
  if (envString(ENV.DOT_LOG_FILE) !== requestedLogFile) {
    setEnv(ENV.DOT_LOG_MIRROR_FILE, requestedLogFile);
  } else {
    unsetEnv(ENV.DOT_LOG_MIRROR_FILE);
  }
  setEnv(ENV.DOT_TEE_INHERIT_LOG, "1");
  const logFile = envString(ENV.DOT_LOG_FILE)!;
  mkdirSync(dirname(logFile), { recursive: true });
  writeMirroredLog(logFile, "", { truncate: true });
}

function privateDotfilesPath(): string {
  return expandHomePath(
    envString(ENV.DOTFILES_PRIVATE_DIR) ?? join(CONFIG_DIR, "dotfiles-private"),
  );
}

function bootstrapPrivateDotfilesForInit(mode: Mode): void {
  if (mode.type !== "native" || mode.command !== "init") return;
  if (mode.args.includes("--help") || mode.args.includes("-h")) return;
  if (envString(ENV.DOT_ALLOW_PRIVATE) === "never") return;

  const privatePath = privateDotfilesPath();
  if (bootstrapGitRepoExists(privatePath)) {
    const exitCode = bootstrapGitPullRebase(privatePath, appendBootstrapLog);
    if (exitCode !== 0) {
      const message = `Failed to update private dotfiles at ${privatePath}\n`;
      process.stderr.write(message);
      appendBootstrapLog(message);
      if (envString(ENV.DOT_ALLOW_PRIVATE) === "always") process.exit(exitCode);
    }
    return;
  }

  if (!ghAuthenticated()) {
    const message =
      "[WARN] Skipping private dotfiles clone; run `gh auth login` before `dot init` if private dotfiles are wanted.\n";
    if (envString(ENV.DOT_ALLOW_PRIVATE) === "always") {
      process.stderr.write(message);
      appendBootstrapLog(message);
      process.exit(1);
    }
    process.stderr.write(message);
    appendBootstrapLog(message);
    return;
  }

  const exitCode = bootstrapGhRepoClone(
    PRIVATE_DOTFILES_REPO,
    privatePath,
    appendBootstrapLog,
  );
  if (exitCode !== 0) {
    process.stderr.write(
      `Failed to clone ${PRIVATE_DOTFILES_REPO} to ${privatePath}\n`,
    );
    process.exit(exitCode);
  }
}

configureInitLogging(mode);
bootstrapPrivateDotfilesForInit(mode);

const workflowOpts: WorkflowRunQueryOptions | undefined = flags.since
  ? { since: flags.since }
  : undefined;
const notificationOpts = parseNotificationOpts(
  flags.rest,
  flags.since,
  mode.type === "tui",
);

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
  defaultBarFilter = false,
): GitNotificationQueryOptions | undefined {
  const all = args.includes("--all");
  const participating = args.includes("--participating");
  const barFilter = defaultBarFilter || args.includes("--bar-filter");
  if (!all && !participating && !since && !barFilter) return undefined;
  return {
    ...(all && { all: true }),
    ...(participating && { participating: true }),
    ...(since && { since }),
    ...(barFilter && { barFilter: true }),
  };
}

function hasNotificationNativeFlag(args: readonly string[]): boolean {
  return (
    hasBarJsonFlag(args) ||
    args.includes("--mark-bot-read") ||
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
  | GitLog
  | GitHub
  | GitNotifications
  | GitStaging
  | Launcher
  | Notes
  | OutputLog
  | WorkflowRuns;
type NativeEffect = Effect.Effect<void, unknown, NativeEnv>;

// --- Layer Composition ---

/** Minimal layers for native CLI commands (no renderer, no TUI services) */
const GitLogLayer = GitLog.layer.pipe(Layer.provideMerge(DotDiff.layer));
const DashboardLayer = Dashboard.layer.pipe(Layer.provideMerge(DotDiff.layer));

const CliLayers = Launcher.cliLayer.pipe(
  Layer.provideMerge(GitLogLayer),
  Layer.provideMerge(WorkflowRuns.layer),
  Layer.provideMerge(GitNotifications.layer),
  Layer.provideMerge(GitStaging.layer),
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
    if (args.includes("--mark-bot-read")) {
      return notificationsMarkBotRead(notificationOpts, {
        dryRun: args.includes("--dry-run"),
      });
    }
    if (hasBarJsonFlag(args)) return notificationsBarJson(notificationOpts);
    if (args.includes("--list-threads")) {
      return notificationsListThreads(notificationOpts);
    }
    return notificationsRaw(notificationOpts);
  };

  type NativeCommandHandler = (args: readonly string[]) => NativeEffect;
  const nativeCommandHandlers: Readonly<Record<string, NativeCommandHandler>> =
    {
      init,
      install: () => install,
      update: (args) => {
        if (args.includes("--check") || args.includes("--check-all")) {
          return updateCheck({ all: args.includes("--check-all") });
        }
        const postHookRepo = optionValue(args, UPDATE_POST_HOOK_REPO_ARG);
        return update({
          pull: args.includes("--pull"),
          stow: args.includes("--stow"),
          tui: args.includes("--tui"),
          selfUpdate: !hasOption(args, UPDATE_DISABLE_SELF_UPDATE_ARG),
          postHookRepos: postHookRepo ? [postHookRepo] : [],
        });
      },
      stow: (args) =>
        stow({
          publicOnly: args.includes("--public"),
          privateOnly: args.includes("--private"),
        }),
      doctor: (args) =>
        doctor({
          openOpencode: args.includes("--open-opencode"),
        }),
      clean: () => clean,
      "git-log": () => gitLogRaw,
      "git-status": (args) =>
        gitStatusRaw({
          diff: args.includes("--diff"),
          branchDiff: args.includes("--branch-diff"),
          since: flags.since,
        }),
      "git-commit": (args) =>
        gitCommitRaw({
          message: optionValue(args, "--message") ?? optionValue(args, "-m"),
          paths: optionValues(args, "--path"),
          push: args.includes("--push"),
          dryRun: args.includes("--dry-run"),
          amend: args.includes("--amend"),
        }),
      "git-workflows": resolveWorkflows,
      "git-notifications": resolveNotifications,
      notes: notesCommand,
      note: noteCommand,
      "agents-sync": () => agentsSync,
      "opencode-debug": (args) => {
        const agentIdx = args.indexOf("--agent");
        const agent =
          agentIdx !== -1 && args[agentIdx + 1]
            ? (args[agentIdx + 1] as string)
            : undefined;
        return opencodeDebug({ agent });
      },
      mcp: mcpCommand,
      "is-agent": isAgentCommand,
      "setup-private-repo": () => setupPrivateRepo,
      "private-pkg-publish": privatePkgPublish,
      "skill-updates": (args) =>
        skillUpdates({
          check: args.includes("--check"),
          update: args.includes("--update"),
          skipReview: args.includes("--skip-review"),
        }).pipe(Effect.asVoid),
      "skill-check": (args) =>
        skillCheck({
          openOpencode: args.includes("--open-opencode"),
          diffOrigin: args.includes("--diff-origin"),
        }),
      handoffs: (args) => handoffsList(args.includes("--all")),
      completions,
      help,
    };

  const resolveNative = (
    command: string,
    args: readonly string[],
  ): NativeEffect => {
    const canonical = getCliCommand(command)?.name ?? command;
    const handler = nativeCommandHandlers[canonical];
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
              appendBootstrapLog(`\n[ERROR] ${formatUnknownError(err)}\n`);
              console.error(err);
              process.exit(1);
            }),
          ),
        );

  Effect.runPromise(program).catch((err) => {
    log(`Fatal error: ${err}`);
    appendBootstrapLog(`\n[ERROR] ${formatUnknownError(err)}\n`);
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
  const { CommitSuggest } = await import("./git/services/CommitSuggest.js");
  const { shutdownServer } = await import("./services/OpenCodeServer.js");
  const { createCommandRunner } = await import("./services/CommandRunner.js");
  const { loadTheme } = await import("./theme.js");
  const { App } = await import("./tui/App.js");

  const { initialView, executeItemId, initialNotesFilter } = mode;

  const tuiProgram = Effect.gen(function* () {
    log("Starting...");
    const watcher = yield* RepoWatcher;
    const gitLog = yield* GitLog;
    const workflows = yield* WorkflowRuns;
    const notifications = yield* GitNotifications;
    const dashboard = yield* Dashboard;
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
        onRefreshGitLog: () => {
          Effect.runFork(gitLog.refresh());
        },
        onRefreshWorkflows: () => {
          Effect.runFork(workflows.refresh(workflowOpts));
        },
        onRefreshNotifications: () => {
          Effect.runFork(notifications.refresh(notificationOpts));
        },
        onRefreshDashboard: () => {
          Effect.runFork(dashboard.refresh());
          Effect.runFork(notifications.refresh(notificationOpts));
          Effect.runFork(workflows.refresh(workflowOpts));
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
        finaliseNoteEdit: (filePath) =>
          Effect.runPromise(notes.finaliseEdit(filePath)).then(() => {}),
        updateNotePriority: (filePath, priority) =>
          Effect.runPromise(notes.setPriority(filePath, priority)).then(
            () => {},
          ),
      },
      {
        initialView,
        initialDiffTab: flags.tab,
        executeItemId,
        initialNotesFilter,
      },
    );
    log("App created");

    const gitLogView = app.getGitLogView();
    const workflowsView = app.getWorkflowsView();
    const notificationsView = app.getNotificationsView();

    let currentRepoState = yield* watcher.getState();
    let currentDashboardState = yield* dashboard.getState();
    let currentWorkflowState = yield* workflows.getState();
    let currentNotificationState = yield* notifications.getState();

    const updateDashboardView = () => {
      app.updateDashboardState(
        buildDashboardState({
          repoState: currentRepoState,
          sourceState: currentDashboardState,
          notifications: currentNotificationState,
          workflows: currentWorkflowState,
        }),
      );
    };

    // Subscribe to watcher state changes and update the diff view
    yield* watcher.subscribe().pipe(
      Stream.runForEach((state) =>
        Effect.sync(() => {
          log(
            `State update: ${state.changed.length} changed, ${state.unchanged.length} unchanged`,
          );
          currentRepoState = state;
          app.updateDiffState(state);
          updateDashboardView();
        }),
      ),
      Effect.forkScoped,
    );
    log("Subscribed to state stream");

    // Subscribe to git log state changes and update the git log view
    yield* gitLog.subscribe().pipe(
      Stream.runForEach((state) =>
        Effect.sync(() => {
          log(`Git log update: ${state.repos.length} repositories`);
          gitLogView.update(state);
        }),
      ),
      Effect.forkScoped,
    );
    log("Subscribed to git log stream");

    // Subscribe to workflow state changes and update the workflows view
    yield* workflows.subscribe().pipe(
      Stream.runForEach((state) =>
        Effect.sync(() => {
          log(`Workflow update: ${state.repos.length} watched repos`);
          currentWorkflowState = state;
          workflowsView.update(state);
          updateDashboardView();
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
          currentNotificationState = state;
          notificationsView.update(state);
          updateDashboardView();
        }),
      ),
      Effect.forkScoped,
    );
    log("Subscribed to notification stream");

    // Subscribe to dashboard source state and update dashboard cards
    yield* dashboard.subscribe().pipe(
      Stream.runForEach((state) =>
        Effect.sync(() => {
          log("Dashboard source update");
          currentDashboardState = state;
          updateDashboardView();
        }),
      ),
      Effect.forkScoped,
    );
    log("Subscribed to dashboard stream");

    // Push current state immediately for first paint
    const initialState = currentRepoState;
    log(
      `Initial state: ${initialState.changed.length} changed, ${initialState.unchanged.length} unchanged`,
    );
    app.updateDiffState(initialState);

    const initialGitLogState = yield* gitLog.getState();
    gitLogView.update(initialGitLogState);

    const initialWorkflowState = currentWorkflowState;
    workflowsView.update(initialWorkflowState);

    const initialNotificationState = currentNotificationState;
    notificationsView.update(initialNotificationState);

    updateDashboardView();

    log("Starting renderer...");
    renderer.start();
    log("Renderer started — TUI is live");

    // Keep alive until the process exits
    return yield* Effect.never;
  });

  // Resolve theme synchronously (uses readFileSync, no async deps)
  const theme = Effect.runSync(loadTheme);

  const TuiLayers = RepoWatcher.layer.pipe(
    Layer.provideMerge(GitLogLayer),
    Layer.provideMerge(WorkflowRuns.layer),
    Layer.provideMerge(DashboardLayer),
    Layer.provideMerge(GitNotifications.layer),
    Layer.provideMerge(Notes.layer),
    Layer.provideMerge(GitHub.layer),
    Layer.provideMerge(GitDiffWaybarCache.layer),
    Layer.provideMerge(GitStaging.layer),
    Layer.provideMerge(CommitSuggest.layer),
    Layer.provideMerge(Toast.layer(theme)),
    Layer.provideMerge(Renderer.layer(theme, nativeLibPath)),
    Layer.provideMerge(OutputLog.tuiLayer),
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
