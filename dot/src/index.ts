import { Effect, Layer } from "effect";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { Config } from "./services/Config.js";
import { CommandExecutor } from "./services/CommandExecutor.js";
import { OutputLog } from "./services/OutputLog.js";
import { Launcher } from "./services/Launcher.js";
import { DotDiff } from "./git/services/DotDiff.js";
import { GitHub } from "./git/services/GitHub.js";
import { GitNotifications } from "./git/services/GitNotifications.js";
import { GitStaging } from "./git/services/GitStaging.js";
import { parseFlags, printHelp } from "./flags.js";
import { renderHelp } from "./cli/help.js";
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
import { formatCause } from "./lib/schema.js";
import { withStepTimeout } from "./lib/workflowStep.js";
import { configureFirewallRules } from "./lib/firewallSetup.js";
import { applyOmarchyShellConfig } from "./lib/omarchyShellConfig.js";
import { omarchyPlugin } from "./commands/OmarchyPlugin.js";
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
import {
  skillUpdatesAgent,
  SkillUpdatesAgentError,
} from "./commands/SkillUpdatesAgent.js";
import { skillCheck } from "./commands/SkillCheck.js";
import { completions } from "./commands/Completions.js";
import { usage } from "./commands/Usage.js";
import {
  workspaceRelayout,
  WorkspaceRelayoutError,
} from "./commands/WorkspaceRelayout.js";
import {
  workspaceCapture,
  workspaceRestore,
} from "./commands/WorkspaceSession.js";
import { launchFloatingWebapp } from "./commands/LaunchFloatingWebapp.js";
import { help } from "./commands/Help.js";
import {
  diffBarJson,
  diffPanelJson,
  diffListChanged,
  diffListAll,
  diffRaw,
} from "./git/commands/Diff.js";
import { gitCommitRaw } from "./git/commands/Commit.js";
import {
  notificationsAction,
  notificationsListThreads,
  notificationsRaw,
  notificationsBarJson,
  notificationsMarkBotRead,
  notificationsOpenShell,
} from "./git/commands/Notifications.js";
import type {
  GitNotificationAction,
  GitNotificationQueryOptions,
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

type Mode = { readonly command: string; readonly args: readonly string[] };

const NOTIFICATION_ACTION_FLAGS: readonly {
  readonly flag: string;
  readonly action: GitNotificationAction;
}[] = [
  { flag: "--mark-read", action: "read" },
  { flag: "--mark-done", action: "done" },
  { flag: "--ignore", action: "ignore" },
  { flag: "--unignore", action: "unignore" },
];

function resolveMode(command: string | undefined): Mode {
  if (!command) {
    printHelp();
    process.exit(0);
  }
  if (nativeCommandNames.has(command)) {
    return { command, args: flags.rest };
  }
  console.error(`dot: unknown command '${command}'`);
  console.error("Run 'dot --help' to see available commands.");
  process.exit(1);
}

/**
 * Record a best-effort usage event for this invocation. The command path is the
 * resolved subcommand, never positional argument values.
 */
function recordUsage(current: Mode): void {
  const invokedCommand = current.command;
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

const mode = resolveMode(flags.subcommand);
if (flags.help) {
  printHelp(mode.command);
  process.exit(0);
}
recordUsage(mode);

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

const formatUnknownError = formatCause;

function configureInitLogging(mode: Mode): void {
  if (mode.command !== "init") return;
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
  if (mode.command !== "init") return;
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

const notificationOpts = parseNotificationOpts(flags.rest, flags.since);

function parseNotificationOpts(
  args: readonly string[],
  since: string | undefined,
): GitNotificationQueryOptions | undefined {
  const all = args.includes("--all");
  const participating = args.includes("--participating");
  const barFilter = args.includes("--bar-filter");
  if (!all && !participating && !since && !barFilter) return undefined;
  return {
    ...(all && { all: true }),
    ...(participating && { participating: true }),
    ...(since && { since }),
    ...(barFilter && { barFilter: true }),
  };
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

type NativeEnv =
  | Config
  | CommandExecutor
  | DotDiff
  | GitHub
  | GitNotifications
  | GitStaging
  | Launcher
  | OutputLog;
type NativeEffect = Effect.Effect<void, unknown, NativeEnv>;

const NATIVE_COMMAND_TIMEOUT_SECONDS = {
  install: 10 * 60,
  stow: 3 * 60,
  clean: 3 * 60,
  "setup-private-repo": 10 * 60,
  "setup-public-repo": 3 * 60,
  "private-pkg-publish": 30 * 60,
  firewall: 3 * 60,
  "skill-check": 5 * 60,
  "skill-updates-agent": 2 * 60 * 60,
  "agents-sync": 2 * 60,
  "mcp-sync": 2 * 60,
  "notes-capture-sync": 2 * 60,
  completions: 2 * 60,
} satisfies Partial<Record<string, number>>;

function nativeCommandTimeout(command: string): number | undefined {
  return Object.entries(NATIVE_COMMAND_TIMEOUT_SECONDS).find(
    ([name]) => name === command,
  )?.[1];
}

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
  const seconds = nativeCommandTimeout(command);
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

/** Application layers shared by native CLI commands. */
const CliLayers = Launcher.layer.pipe(
  Layer.provideMerge(DotDiff.layer),
  Layer.provideMerge(GitNotifications.layer),
  Layer.provideMerge(GitStaging.layer),
  Layer.provideMerge(GitHub.layer),
  Layer.provideMerge(OutputLog.layer),
  Layer.provideMerge(CommandExecutor.layer),
  Layer.provideMerge(Config.layer),
);

// --- Execution ---

{
  const resolveDiff = (args: readonly string[]): NativeEffect => {
    const noFetch = args.includes("--no-fetch");
    const opts = noFetch ? { noFetch: true } : undefined;
    if (hasBarJsonFlag(args)) return diffBarJson(opts);
    if (args.includes("--panel-json")) return diffPanelJson(opts);
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
    if (args.includes("--raw") || notificationOpts) {
      return notificationsRaw(notificationOpts);
    }
    return notificationsOpenShell;
  };

  type NativeCommandHandler = (args: readonly string[]) => NativeEffect;
  const nativeCommandHandlers = {
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
    "omarchy-plugin": omarchyPlugin,
    "omarchy-shell-config": () => applyOmarchyShellConfig.pipe(Effect.asVoid),
    doctor: (args) =>
      doctor({
        openOpencode: args.includes("--open-opencode"),
      }),
    clean: () => clean,
    firewall: () => configureFirewallRules,
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
    "skill-updates-agent": (args) => {
      const mode = args[0];
      if (mode !== "github" && mode !== "device") {
        return Effect.fail(
          new SkillUpdatesAgentError({
            operation: "mode",
            message: "skill-updates-agent requires github or device mode",
          }),
        );
      }
      return skillUpdatesAgent({
        mode,
        configPath: optionValue(args, "--config"),
        runId: optionValue(args, "--run-id"),
        skillsDir: optionValue(args, "--skills-dir"),
      });
    },
    "skill-check": (args) =>
      skillCheck({
        openOpencode: args.includes("--open-opencode"),
        diffOrigin: args.includes("--diff-origin"),
        skill: optionValue(args, "--skill"),
      }),
    completions,
    usage,
    "launch-floating-webapp": launchFloatingWebapp,
    "workspace-relayout": (args) => {
      const unknown = args.find((arg) => arg !== "--edit");
      return unknown
        ? Effect.fail(
            new WorkspaceRelayoutError({
              message: `Unknown workspace-relayout argument: ${unknown}`,
            }),
          )
        : workspaceRelayout({ edit: args.includes("--edit") });
    },
    "workspace-capture": (args) => {
      const unknown = args.find(
        (arg) =>
          arg !== "--current-workspace" &&
          arg !== "--current" &&
          !arg.startsWith("--output=") &&
          !arg.startsWith("--state-dir="),
      );
      return unknown
        ? Effect.sync(() => {
            console.error(`workspace-capture: unknown option: ${unknown}`);
            console.error(renderHelp("workspace-capture"));
            process.exitCode = 1;
          })
        : workspaceCapture({
            currentWorkspace:
              args.includes("--current-workspace") ||
              args.includes("--current"),
            output: optionValue(args, "--output"),
            stateDir: optionValue(args, "--state-dir"),
          });
    },
    "workspace-restore": (args) => {
      const unknown = args.find(
        (arg) =>
          arg !== "--dry-run" &&
          arg !== "--dryrun" &&
          arg !== "--no-launch" &&
          arg !== "--no-move" &&
          !arg.startsWith("--file=") &&
          !arg.startsWith("--state-dir="),
      );
      return unknown
        ? Effect.sync(() => {
            console.error(`workspace-restore: unknown option: ${unknown}`);
            console.error(renderHelp("workspace-restore"));
            process.exitCode = 1;
          })
        : workspaceRestore({
            dryRun: args.includes("--dry-run") || args.includes("--dryrun"),
            file: optionValue(args, "--file"),
            stateDir: optionValue(args, "--state-dir"),
            launchMissing: !args.includes("--no-launch"),
            moveExisting: !args.includes("--no-move"),
          });
    },
    help,
  } satisfies Readonly<Record<string, NativeCommandHandler>>;

  const resolveNative = (
    command: string,
    args: readonly string[],
  ): NativeEffect => {
    const canonical = getCliCommand(command)?.name ?? command;
    const handler = Object.entries(nativeCommandHandlers).find(
      ([name]) => name === canonical,
    )?.[1];
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
          Effect.catch((cause) =>
            Effect.promise(async () => {
              appendBootstrapLog(`\n[ERROR] ${formatUnknownError(cause)}\n`);
              console.error(cause);
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
}
