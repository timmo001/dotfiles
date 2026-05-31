import { Effect, Schema } from "effect";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
} from "fs";
import { basename, join } from "path";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { agentsSync } from "./AgentsSync.js";
import { install } from "./Install.js";
import { update } from "./Update.js";
import { setupPrivatePackageRepo } from "./SetupPrivateRepo.js";
import { loadPrivatePackageRepoConfig } from "../doctor/checks/packages.js";
import { runElevated } from "../lib/elevatedCommand.js";
import {
  ensureStowInstalled,
  installMissingArchPackages,
} from "../lib/packageSetup.js";
import { syncOmarchyRepos } from "../lib/omarchySync.js";
import { displayPath, resolveLinkTarget } from "../lib/omarchyHost.js";
import {
  initCompleteMarker,
  initInProgressMarker,
  writeInitCompleteMarker,
  writeInitInProgressMarker,
} from "../lib/initState.js";
import type { ConfigService } from "../services/Config.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;
const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME ?? join(HOME, ".config");
const GIT_INCLUDE_PATH = "~/.config/git/config.dotfiles";
const DOCTOR_STARTUP_TIMER_UNIT = "dot-doctor-startup.timer";

/** Domain error for first-use init failures. */
class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  message: Schema.String,
}) {}

interface InitOptions {
  readonly confirm: boolean;
  readonly noninteractive: boolean;
  readonly branch?: string;
  readonly bootstrapBranch?: string;
}

interface InitOptionsDraft {
  confirm: boolean;
  noninteractive: boolean;
  branch?: string;
  bootstrapBranch?: string;
}

type ParsedInitArgs =
  | { readonly type: "options"; readonly options: InitOptions }
  | { readonly type: "help" }
  | { readonly type: "error"; readonly message: string };

type ParseInitArgResult =
  | { readonly type: "continue"; readonly consumed: number }
  | { readonly type: "help" }
  | { readonly type: "error"; readonly message: string };

type BooleanInitOptionHandler = (options: InitOptionsDraft) => void;
type ValueInitOptionHandler = (
  options: InitOptionsDraft,
  value: string,
) => void;

const booleanInitOptions = new Map<string, BooleanInitOptionHandler>([
  ["--confirm", (options) => void (options.confirm = true)],
  ["--noninteractive", (options) => void (options.noninteractive = true)],
  ["--interactive", (options) => void (options.noninteractive = false)],
]);

const valueInitOptions = new Map<string, ValueInitOptionHandler>([
  ["--branch", (options, value) => void (options.branch = value)],
  [
    "--bootstrap-branch",
    (options, value) => void (options.bootstrapBranch = value),
  ],
]);

function fail(message: string): Effect.Effect<never, InitError> {
  return Effect.fail(new InitError({ message }));
}

function symlinkTarget(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isSymbolicLink()) return null;
    return resolveLinkTarget(path, readlinkSync(path));
  } catch {
    return null;
  }
}

function isManagedTarget(target: string, config: ConfigService): boolean {
  if (target.startsWith(config.publicDotfiles)) return true;
  return config.privateDotfiles
    ? target.startsWith(config.privateDotfiles)
    : false;
}

function isManagedSymlink(path: string, config: ConfigService): boolean {
  const target = symlinkTarget(path);
  return target ? isManagedTarget(target, config) : false;
}

function gitConfigIncludesManagedPath(): boolean {
  const gitConfigFile = join(HOME, ".config", "git", "config");
  if (!existsSync(gitConfigFile)) return false;
  return readFileSync(gitConfigFile, "utf-8").includes(
    `path = ${GIT_INCLUDE_PATH}`,
  );
}

function existingInitSignals(config: ConfigService): readonly string[] {
  const signals: string[] = [];
  if (gitConfigIncludesManagedPath()) {
    signals.push(`managed git include (${GIT_INCLUDE_PATH})`);
  }
  if (isManagedSymlink(join(HOME, ".local", "bin", "dot"), config)) {
    signals.push("managed dot binary symlink (~/.local/bin/dot)");
  }
  if (
    isManagedSymlink(join(HOME, ".config", "git", "config.dotfiles"), config)
  ) {
    signals.push("managed git config symlink (~/.config/git/config.dotfiles)");
  }
  return signals;
}

function assertFreshInitTarget(
  config: ConfigService,
): Effect.Effect<void, InitError, OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const completeMarker = initCompleteMarker(config);
    const inProgressMarker = initInProgressMarker(config);

    if (existsSync(completeMarker)) {
      return yield* fail(
        `dot init has already completed on this machine (${displayPath(completeMarker)}). Use dot update for ongoing maintenance.`,
      );
    }

    if (existsSync(inProgressMarker)) {
      yield* log.warn(
        `Retrying incomplete init attempt (${displayPath(inProgressMarker)})`,
      );
      return;
    }

    const signals = existingInitSignals(config);
    if (signals.length >= 2) {
      return yield* fail(
        `This machine already looks initialised: ${signals.join(", ")}. Use dot update for ongoing maintenance.`,
      );
    }
  });
}

function parseValueInitOption(
  options: InitOptionsDraft,
  name: string,
  value: string | undefined,
): ParseInitArgResult {
  const handler = valueInitOptions.get(name);
  if (!handler)
    return { type: "error", message: `Unknown init option: ${name}` };
  if (!value) return { type: "error", message: `${name} requires a value` };
  handler(options, value);
  return { type: "continue", consumed: 2 };
}

function parseEqualsInitOption(
  options: InitOptionsDraft,
  arg: string,
): ParseInitArgResult {
  const separator = arg.indexOf("=");
  return parseValueInitOption(
    options,
    arg.slice(0, separator),
    arg.slice(separator + 1),
  );
}

function parseSpecialInitArg(
  options: InitOptionsDraft,
  arg: string,
): ParseInitArgResult | null {
  if (arg === "--help" || arg === "-h") return { type: "help" };

  const booleanHandler = booleanInitOptions.get(arg);
  if (booleanHandler) {
    booleanHandler(options);
    return { type: "continue", consumed: 1 };
  }

  return null;
}

function parseValueLikeInitArg(
  options: InitOptionsDraft,
  args: readonly string[],
  index: number,
): ParseInitArgResult {
  const arg = args[index];
  return arg.includes("=")
    ? parseEqualsInitOption(options, arg)
    : parseValueInitOption(options, arg, args[index + 1]);
}

function parseInitArg(
  options: InitOptionsDraft,
  args: readonly string[],
  index: number,
): ParseInitArgResult {
  return (
    parseSpecialInitArg(options, args[index]) ??
    parseValueLikeInitArg(options, args, index)
  );
}

function parseInitArgs(args: readonly string[]): ParsedInitArgs {
  const options: InitOptionsDraft = {
    confirm: false,
    noninteractive: process.env.DOT_INIT_NONINTERACTIVE === "1",
  };

  for (let index = 0; index < args.length; index++) {
    const parsed = parseInitArg(options, args, index);
    if (parsed.type !== "continue") return parsed;
    index += parsed.consumed - 1;
  }

  return { type: "options", options: { ...options } };
}

function printInitHelp(): void {
  console.log(`Usage: dot init [options]

Run the one-time first-use setup workflow for a fresh machine. Init prepares
repos, packages, stow links, machine hooks, and then finishes by running
dot update. After init completes, use dot update for ongoing maintenance.

Options:
  --confirm                 Acknowledge non-interactive package helpers
  --noninteractive          Skip interactive prompts for this run
  --interactive             Allow interactive prompts for this run
  --branch <name>           Branch override for non-bootstrap Omarchy repos
  --bootstrap-branch <name> Branch override for bootstrap
  --help, -h                Show this help message

Examples:
  dot init --noninteractive --confirm
  dot init --branch main --bootstrap-branch distro/omarchy`);
}

function configureGitInclude(): Effect.Effect<
  void,
  InitError,
  CommandExecutor | OutputLog
> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;
    const managedConfig = join(HOME, ".config", "git", "config.dotfiles");

    yield* log.section("Configure Git");
    if (!existsSync(managedConfig)) {
      return yield* fail(
        `Stowed git config.dotfiles not found: ${displayPath(managedConfig)}`,
      );
    }

    if (gitConfigIncludesManagedPath()) {
      yield* log.info("Git config already includes managed dotfiles settings");
      return;
    }

    const exitCode = yield* executor.inherit("git", [
      "config",
      "--global",
      "--add",
      "include.path",
      GIT_INCLUDE_PATH,
    ]);
    if (exitCode !== 0) {
      return yield* fail(`git config include.path exited ${exitCode}`);
    }
    yield* log.info(`Added git config include: ${GIT_INCLUDE_PATH}`);
  });
}

function pacmanHookFiles(hooksSource: string): readonly string[] {
  return readdirSync(hooksSource).filter((name) => name.endsWith(".hook"));
}

function installPacmanHook(
  hooksSource: string,
  hookFile: string,
): Effect.Effect<void, InitError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const source = join(hooksSource, hookFile);
    const target = join("/etc", "pacman.d", "hooks", basename(hookFile));
    const exitCode = yield* runElevated("install", ["-Dm644", source, target]);
    if (exitCode !== 0) {
      return yield* fail(
        `install ${displayPath(source)} ${target} exited ${exitCode}`,
      );
    }
    yield* log.info(`Installed ${hookFile}`);
  });
}

function installPacmanHooks(): Effect.Effect<
  void,
  InitError,
  CommandExecutor | OutputLog
> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const hooksSource = join(XDG_CONFIG_HOME, "pacman-hooks");

    yield* log.section("Install Pacman Hooks");
    if (!existsSync(hooksSource)) {
      yield* log.info(
        `No pacman hooks directory found: ${displayPath(hooksSource)}`,
      );
      return;
    }

    const hookFiles = pacmanHookFiles(hooksSource);
    if (hookFiles.length === 0) {
      yield* log.info("No pacman hooks configured");
      return;
    }

    for (const hookFile of hookFiles) {
      yield* installPacmanHook(hooksSource, hookFile);
    }
  });
}

function runUserSystemctl(
  args: readonly string[],
): Effect.Effect<void, InitError, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const exitCode = yield* executor.inherit("systemctl", ["--user", ...args]);
    if (exitCode !== 0) {
      return yield* fail(
        `systemctl --user ${args.join(" ")} exited ${exitCode}`,
      );
    }
  });
}

function enableDoctorStartupTimer(): Effect.Effect<
  void,
  InitError,
  CommandExecutor | OutputLog
> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;
    const unitPath = join(
      XDG_CONFIG_HOME,
      "systemd",
      "user",
      DOCTOR_STARTUP_TIMER_UNIT,
    );

    yield* log.section("Enable Doctor Startup Timer");
    if ((yield* executor.exitCode("which", ["systemctl"])) !== 0) {
      yield* log.warn("Skipping doctor startup timer (systemctl not found)");
      return;
    }

    if (!existsSync(unitPath)) {
      return yield* fail(`Missing systemd user unit: ${displayPath(unitPath)}`);
    }

    yield* runUserSystemctl(["daemon-reload"]);
    yield* runUserSystemctl(["enable", "--now", DOCTOR_STARTUP_TIMER_UNIT]);
    yield* log.info(`Enabled ${DOCTOR_STARTUP_TIMER_UNIT}`);
  });
}

function syncAgentsStrict(): Effect.Effect<
  void,
  InitError,
  Config | OutputLog
> {
  return Effect.gen(function* () {
    const source =
      process.env.DOT_AGENTS_SYNC_SOURCE ??
      join(HOME, ".config", "opencode", "AGENTS.md");
    if (!existsSync(source)) {
      return yield* fail(`Agents sync source missing: ${displayPath(source)}`);
    }
    yield* agentsSync;
  });
}

function setupPrivatePackages(
  config: ConfigService,
  options: InitOptions,
): Effect.Effect<void, unknown, Config | CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    if (!config.canUsePrivate) {
      yield* log.warn(
        `Skipping private package setup (${config.privateReason})`,
      );
      return;
    }

    const repo = loadPrivatePackageRepoConfig(config);
    if (!repo) return yield* fail("Missing private package repo config");

    yield* setupPrivatePackageRepo(repo);
    yield* installMissingArchPackages({
      scope: "private",
      confirm: options.confirm,
    });
  });
}

/** Run the one-time first-use setup workflow for a fresh machine. */
export function init(rawArgs: readonly string[]) {
  return Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const parsed = parseInitArgs(rawArgs);

    if (parsed.type === "help") {
      printInitHelp();
      return;
    }
    if (parsed.type === "error") return yield* fail(parsed.message);

    yield* log.section("Initialization Workflow");
    yield* assertFreshInitTarget(config);
    yield* writeInitInProgressMarker(config, parsed.options);

    yield* ensureStowInstalled;
    yield* syncOmarchyRepos({
      branch: parsed.options.branch,
      bootstrapBranch: parsed.options.bootstrapBranch,
    });
    yield* installMissingArchPackages({
      scope: "public",
      confirm: parsed.options.confirm,
    });
    yield* setupPrivatePackages(config, parsed.options);
    yield* install;
    yield* configureGitInclude();
    yield* installPacmanHooks();
    yield* enableDoctorStartupTimer();
    yield* syncAgentsStrict();

    yield* log.section("Final Update");
    yield* update();
    yield* writeInitCompleteMarker(config, "init");
    yield* log.info(
      `Init complete: ${displayPath(initCompleteMarker(config))}`,
    );
  });
}
