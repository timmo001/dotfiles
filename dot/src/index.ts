import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { CliConfig, CliError, Command } from "effect/unstable/cli";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import {
  cliBuiltIns,
  commandHelp,
  dotCommand,
  getCliCommand,
  normalizeCliArgs,
} from "./cli/spec.js";
import {
  bootstrapGhRepoClone,
  bootstrapGitPullRebase,
  bootstrapGitRepoExists,
  ghAuthenticated,
} from "./lib/bootstrapGit.js";
import { detectAgent } from "./lib/agent.js";
import { ENV, envString, setEnv, unsetEnv } from "./lib/env.js";
import { isGvfsPath, writeMirroredLog } from "./lib/logMirror.js";
import { CONFIG_DIR, STATE_DIR, expandHomePath } from "./lib/paths.js";
import { formatCause } from "./lib/schema.js";
import { installUsageHook } from "./lib/usage.js";
import { withStepTimeout, withTimeoutOption } from "./lib/workflowStep.js";
import { DotDiff } from "./git/services/DotDiff.js";
import { GitHub } from "./git/services/GitHub.js";
import { GitNotifications } from "./git/services/GitNotifications.js";
import { GitStaging } from "./git/services/GitStaging.js";
import { CommandExecutor } from "./services/CommandExecutor.js";
import { Config } from "./services/Config.js";
import { Launcher } from "./services/Launcher.js";
import { OutputLog } from "./services/OutputLog.js";

const DEFAULT_INIT_LOG_FILE = join(STATE_DIR, "dot", "init.log");
const PRIVATE_DOTFILES_REPO = "timmo001/dotfiles-private";
const args = normalizeCliArgs(process.argv.slice(2));

const invokedCommand = args.find((arg) => !arg.startsWith("-"));
const unsupportedNegation = args.find(
  (arg) =>
    arg.startsWith("---") || arg === "--no-help" || arg.startsWith("--no-no-"),
);
if (unsupportedNegation) {
  console.error(`dot: unknown option '${unsupportedNegation}'`);
  process.exit(1);
}
if (invokedCommand && !getCliCommand(invokedCommand)) {
  console.error(`dot: unknown command '${invokedCommand}'`);
  console.error("Run 'dot --help' to see available commands.");
  process.exit(1);
}

function optionValue(name: string): string | undefined {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function validateFloatingWebappWidth(): void {
  if (args[0] !== "launch-floating-webapp") return;
  const width = optionValue("--width");
  if (width === undefined || /^\d+$/.test(width)) return;
  console.error("launch-floating-webapp: WIDTH must be a non-negative integer");
  process.exit(2);
}

function appendBootstrapLog(message: string | Uint8Array): void {
  const logFile = envString(ENV.DOT_LOG_FILE);
  if (logFile) writeMirroredLog(logFile, message);
}

function prepareInit(): void {
  if (args[0] !== "init" || args.includes("--help") || args.includes("-h"))
    return;
  const requested = expandHomePath(
    optionValue("--log") ??
      envString(ENV.DOT_INIT_LOG_FILE) ??
      DEFAULT_INIT_LOG_FILE,
  );
  setEnv(
    ENV.DOT_LOG_FILE,
    isGvfsPath(requested) ? DEFAULT_INIT_LOG_FILE : requested,
  );
  if (envString(ENV.DOT_LOG_FILE) !== requested)
    setEnv(ENV.DOT_LOG_MIRROR_FILE, requested);
  else unsetEnv(ENV.DOT_LOG_MIRROR_FILE);
  setEnv(ENV.DOT_TEE_INHERIT_LOG, "1");
  const logFile = envString(ENV.DOT_LOG_FILE);
  if (!logFile) return;
  mkdirSync(dirname(logFile), { recursive: true });
  writeMirroredLog(logFile, "", { truncate: true });

  if (envString(ENV.DOT_ALLOW_PRIVATE) === "never") return;
  const privatePath = expandHomePath(
    envString(ENV.DOTFILES_PRIVATE_DIR) ?? join(CONFIG_DIR, "dotfiles-private"),
  );
  if (bootstrapGitRepoExists(privatePath)) {
    const exitCode = bootstrapGitPullRebase(privatePath, appendBootstrapLog);
    if (exitCode !== 0 && envString(ENV.DOT_ALLOW_PRIVATE) === "always")
      process.exit(exitCode);
    return;
  }
  if (!ghAuthenticated()) {
    const message =
      "[WARN] Skipping private dotfiles clone; run `gh auth login` before `dot init` if private dotfiles are wanted.\n";
    process.stderr.write(message);
    appendBootstrapLog(message);
    if (envString(ENV.DOT_ALLOW_PRIVATE) === "always") process.exit(1);
    return;
  }
  const exitCode = bootstrapGhRepoClone(
    PRIVATE_DOTFILES_REPO,
    privatePath,
    appendBootstrapLog,
  );
  if (exitCode !== 0) process.exit(exitCode);
}

function recordUsage(): void {
  const command = invokedCommand ? getCliCommand(invokedCommand) : undefined;
  const allowedFlags = new Set(
    (command ? commandHelp(command, ["dot", command.name]).flags : []).flatMap(
      (flag) =>
        [flag.name, ...flag.aliases].map((name) =>
          name.startsWith("-") ? name : `--${name}`,
        ),
    ),
  );
  installUsageHook({
    tool: "dot",
    invokedAs: "dot",
    command: command ? [command.name] : [],
    args,
    allowedFlags,
    invoker: args.includes("--bar-json")
      ? "automation"
      : detectAgent().isAgent
        ? "agent"
        : "human",
  });
}

validateFloatingWebappWidth();
prepareInit();
recordUsage();

const CliLayers = Launcher.layer.pipe(
  Layer.provideMerge(DotDiff.layer),
  Layer.provideMerge(GitNotifications.layer),
  Layer.provideMerge(GitStaging.layer),
  Layer.provideMerge(GitHub.layer),
  Layer.provideMerge(OutputLog.layer),
  Layer.provideMerge(CommandExecutor.layer),
  Layer.provideMerge(Config.layer),
);

const NATIVE_COMMAND_TIMEOUT_SECONDS = {
  install: 10 * 60,
  stow: 3 * 60,
  clean: 3 * 60,
  "setup-private-repo": 10 * 60,
  "setup-public-repo": 3 * 60,
  "private-pkg-publish": 30 * 60,
  firewall: 3 * 60,
  skills: 2 * 60 * 60,
  "agents-sync": 2 * 60,
  "mcp-sync": 2 * 60,
  "notes-capture-sync": 2 * 60,
  "agent-oxlint": 10 * 60,
  completions: 2 * 60,
} satisfies Partial<Record<string, number>>;

function commandLabel(command: string): string {
  return command
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function withNativeCommandTimeout<E, R>(
  command: string | undefined,
  effect: Effect.Effect<void, E, R>,
): Effect.Effect<void, E, R | OutputLog> {
  const seconds = command
    ? Object.entries(NATIVE_COMMAND_TIMEOUT_SECONDS).find(
        ([name]) => name === command,
      )?.[1]
    : undefined;
  if (!seconds || !command) return effect;
  if (command === "skills" && args.includes("--json")) {
    return Effect.gen(function* () {
      const completed = yield* withTimeoutOption(effect, seconds);
      if (Option.isNone(completed)) {
        console.error(
          `${commandLabel(command)} exceeded ${seconds}s and was stopped`,
        );
        process.exitCode = 1;
      }
    });
  }
  return Effect.gen(function* () {
    const completed = yield* withStepTimeout(
      commandLabel(command),
      seconds,
      effect,
    );
    if (!completed) process.exitCode = 1;
  });
}

const commandProgram = Command.runWith(dotCommand, { version: "1.0.0" })(
  args.length === 0 ? ["--help"] : args,
);
const program = withNativeCommandTimeout(
  getCliCommand(invokedCommand ?? "")?.name,
  commandProgram,
).pipe(
  Effect.provide(
    Layer.mergeAll(
      CliLayers,
      NodeServices.layer,
      CliConfig.layer({ builtIns: cliBuiltIns }),
    ),
  ),
  Effect.catch((error) =>
    Effect.sync(() => {
      appendBootstrapLog(`\n[ERROR] ${formatCause(error)}\n`);
      if (!CliError.isCliError(error)) console.error(error);
      process.exitCode =
        CliError.isCliError(error) &&
        (invokedCommand === "launch-floating-webapp" ||
          invokedCommand === "herdr-repo-open")
          ? 2
          : 1;
    }),
  ),
);

Effect.runPromise(program)
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    appendBootstrapLog(`\n[ERROR] ${formatCause(error)}\n`);
    console.error(error);
    process.exit(1);
  });
