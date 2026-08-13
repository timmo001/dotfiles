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
import { Dashboard } from "./dashboard/services/Dashboard.js";
import { buildDashboardState } from "./dashboard/viewModel.js";
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
import { installUsageHook } from "./lib/usage.js";
import { withStepTimeout } from "./lib/workflowStep.js";
import { configureFirewallRules } from "./lib/firewallSetup.js";
import { applyOmarchyShellConfig } from "./lib/omarchyShellConfig.js";
import { menuItemsById } from "./menu.js";
import { init } from "./commands/Init.js";
import { install } from "./commands/Install.js";
import { update, updateCheck } from "./commands/Update.js";
import { stow } from "./commands/Stow.js";
import { doctor } from "./commands/Doctor.js";
import { clean } from "./commands/Clean.js";
import { agentsSync } from "./commands/AgentsSync.js";
import { notesCaptureSync } from "./commands/NotesCaptureSync.js";
import { mcpSync } from "./mcp/commands/McpSync.js";
import { isAgentCommand } from "./commands/IsAgent.js";
import { setupPrivateRepo } from "./commands/SetupPrivateRepo.js";
import { setupPublicRepo } from "./commands/SetupPublicRepo.js";
import { privatePkgPublish } from "./commands/PrivatePkgPublish.js";
import { skillUpdates } from "./commands/SkillUpdates.js";
import { skillCheck } from "./commands/SkillCheck.js";
import { completions } from "./commands/Completions.js";
import { usage } from "./commands/Usage.js";
import { help } from "./commands/Help.js";
import {
  diffBarJson,
  diffListChanged,
  diffListAll,
  diffRaw,
} from "./git/commands/Diff.js";
import { gitLogRaw } from "./git/commands/Log.js";
import { gitCommitRaw } from "./git/commands/Commit.js";
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
  ViewId,
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
    }
  | { type: "native"; command: string; args: readonly string[] };

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
  dashboard: "context git",
  "git-diff": "dot git-diff --raw",
  "git-log": "dot git-log --raw",
  "git-notifications": "dot git-notifications --raw",
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

/**
 * Record a best-effort usage event for this invocation. The command path is the
 * resolved subcommand (native) or the target view (TUI), never positional
 * argument values.
 */
function recordUsage(current: Mode): void {
  const invokedCommand =
    current.type === "native"
      ? current.command
      : (flags.subcommand ?? current.initialView);
  const commandSpec = getCliCommand(invokedCommand);
  const command = [commandSpec?.name ?? invokedCommand];
  const allowedFlags = new Set(
    commandSpec?.options?.flatMap((option) =>
      option.short ? [option.name, option.short] : [option.name],
    ) ?? [],
  );
  const args = process.argv.slice(2);
  const invoker = args.includes("--bar-json")
    ? "automation"
    : detectAgent().isAgent
      ? "agent"
      : "human";
  installUsageHook({
    tool: "dot",
    invokedAs: "dot",
    command,
    args,
    allowedFlags,
    invoker,
  });
}

const mode = resolveMode();
recordUsage(mode);
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
  | OutputLog;
type NativeEffect = Effect.Effect<void, unknown, NativeEnv>;

const NATIVE_COMMAND_TIMEOUT_SECONDS: Partial<Record<string, number>> = {
  install: 10 * 60,
  stow: 3 * 60,
  clean: 3 * 60,
  "setup-private-repo": 10 * 60,
  "setup-public-repo": 3 * 60,
  "private-pkg-publish": 30 * 60,
  firewall: 3 * 60,
  "skill-check": 5 * 60,
  "agents-sync": 2 * 60,
  "mcp-sync": 2 * 60,
  "notes-capture-sync": 2 * 60,
  completions: 2 * 60,
};

function commandLabel(command: string): string {
  return command
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function withNativeCommandTimeout(
  command: string,
  effect: NativeEffect,
): NativeEffect {
  const seconds = NATIVE_COMMAND_TIMEOUT_SECONDS[command];
  if (!seconds) return effect;
  return Effect.gen(function* () {
    const completed = yield* withStepTimeout(
      commandLabel(command),
      seconds,
      effect,
    );
    if (!completed) {
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
    }
  });
}

// --- Layer Composition ---

/** Minimal layers for native CLI commands (no renderer, no TUI services) */
const GitLogLayer = GitLog.layer.pipe(Layer.provideMerge(DotDiff.layer));

const CliLayers = Launcher.cliLayer.pipe(
  Layer.provideMerge(GitLogLayer),
  Layer.provideMerge(GitNotifications.layer),
  Layer.provideMerge(GitStaging.layer),
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
          app: args.includes("--app"),
          selfUpdate: !hasOption(args, UPDATE_DISABLE_SELF_UPDATE_ARG),
          postHookRepos: postHookRepo ? [postHookRepo] : [],
        });
      },
      stow: (args) =>
        stow({
          publicOnly: args.includes("--public"),
          privateOnly: args.includes("--private"),
        }).pipe(Effect.asVoid),
      "omarchy-shell-config": () => applyOmarchyShellConfig.pipe(Effect.asVoid),
      doctor: (args) =>
        doctor({
          openOpencode: args.includes("--open-opencode"),
        }),
      clean: () => clean,
      firewall: () => configureFirewallRules,
      "git-log": () => gitLogRaw,
      "git-commit": (args) =>
        gitCommitRaw({
          message: optionValue(args, "--message") ?? optionValue(args, "-m"),
          paths: optionValues(args, "--path"),
          push: args.includes("--push"),
          dryRun: args.includes("--dry-run"),
          amend: args.includes("--amend"),
        }),
      "git-notifications": resolveNotifications,
      "agents-sync": () => agentsSync,
      "mcp-sync": () => mcpSync,
      "notes-capture-sync": () => notesCaptureSync,
      "is-agent": isAgentCommand,
      "setup-private-repo": () => setupPrivateRepo,
      "setup-public-repo": () => setupPublicRepo,
      "private-pkg-publish": privatePkgPublish,
      "skill-updates": (args) =>
        skillUpdates({
          check: args.includes("--check"),
          update: args.includes("--update"),
          skipReview: args.includes("--skip-review"),
          json: args.includes("--json"),
          skill: optionValue(args, "--skill"),
          noCommit: args.includes("--no-commit"),
        }).pipe(Effect.asVoid),
      "skill-check": (args) =>
        skillCheck({
          openOpencode: args.includes("--open-opencode"),
          diffOrigin: args.includes("--diff-origin"),
        }),
      completions,
      usage,
      help,
    };

  const resolveNative = (
    command: string,
    args: readonly string[],
  ): NativeEffect => {
    const canonical = getCliCommand(command)?.name ?? command;
    const handler = nativeCommandHandlers[canonical];
    if (handler) return withNativeCommandTimeout(canonical, handler(args));
    return Effect.promise(async () => {
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
            Effect.promise(async () => {
              appendBootstrapLog(`\n[ERROR] ${formatUnknownError(err)}\n`);
              console.error(err);
              process.exit(1);
            }),
          ),
        );

  Effect.runPromise(program)
    .then(() => {
      process.exit(process.exitCode ?? 0);
    })
    .catch((err) => {
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
  const { RepoWatcher } = await import("./git/services/RepoWatcher.js");
  const { createCommandRunner } = await import("./services/CommandRunner.js");
  const { loadTheme } = await import("./theme.js");
  const { App } = await import("./tui/App.js");

  const { initialView, executeItemId } = mode;

  const tuiProgram = Effect.gen(function* () {
    log("Starting...");
    const watcher = yield* RepoWatcher;
    const gitLog = yield* GitLog;
    const notifications = yield* GitNotifications;
    const dashboard = yield* Dashboard;
    const renderer = yield* Renderer;
    const toast = yield* Toast;
    const services = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(services);
    const runPromise = Effect.runPromiseWith(services);
    log("Services ready");

    const commandRunner = createCommandRunner(renderer, toast);

    // Create the app with concrete dependencies
    const app = new App(
      {
        renderer,
        theme,
        commandRunner,
        onRefreshDiff: () => {
          runFork(watcher.refresh());
        },
        onRefreshGitLog: () => {
          runFork(gitLog.refresh());
        },
        onRefreshNotifications: () => {
          runFork(notifications.refresh(notificationOpts));
        },
        onRefreshDashboard: () => {
          runFork(dashboard.refresh());
          runFork(notifications.refresh(notificationOpts));
        },
        onNotificationAction: (action, threadId) => {
          runFork(
            runNotificationAction(
              notifications,
              action,
              threadId,
              notificationOpts,
            ),
          );
        },
      },
      {
        initialView,
        initialDiffTab: flags.tab,
        executeItemId,
      },
    );
    log("App created");

    const gitLogView = app.getGitLogView();
    const notificationsView = app.getNotificationsView();

    let currentRepoState = yield* watcher.getState();
    let currentDashboardState = yield* dashboard.getState();
    let currentNotificationState = yield* notifications.getState();

    const updateDashboardView = () => {
      app.updateDashboardState(
        buildDashboardState({
          repoState: currentRepoState,
          sourceState: currentDashboardState,
          notifications: currentNotificationState,
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
  const DashboardLayer = Dashboard.layer.pipe(
    Layer.provideMerge(DotDiff.layer),
  );

  const TuiLayers = RepoWatcher.layer.pipe(
    Layer.provideMerge(GitLogLayer),
    Layer.provideMerge(DashboardLayer),
    Layer.provideMerge(GitNotifications.layer),
    Layer.provideMerge(GitHub.layer),
    Layer.provideMerge(Toast.layer(theme)),
    Layer.provideMerge(Renderer.layer(theme, nativeLibPath)),
    Layer.provideMerge(OutputLog.tuiLayer),
    Layer.provideMerge(CommandExecutor.layer),
    Layer.provideMerge(Config.layer),
  );

  const runnable = tuiProgram.pipe(Effect.scoped, Effect.provide(TuiLayers));

  log("Launching...");

  Effect.runPromise(runnable).catch((err) => {
    log(`Fatal error: ${err}`);
    console.error(err);
    process.exit(1);
  });
}
