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
import { setupPrivateRepo } from "./SetupPrivateRepo.js";
import { runElevated } from "../lib/elevatedCommand.js";
import { gitRequired } from "../lib/git.js";
import {
  ensureGumInstalled,
  installMissingArchPackages,
  installMiseTools,
} from "../lib/packageSetup.js";
import { syncOmarchyRepos } from "../lib/omarchySync.js";
import { ensureLocalesGenerated } from "../lib/localeSetup.js";
import { configureFirewallRules } from "../lib/firewallSetup.js";
import { installGhExtensions } from "../lib/ghExtensions.js";
import { cloneMissingGitConfigRepos } from "../lib/privateGitRepos.js";
import { CONFIG_DIR, HOME_DIR, displayPath } from "../lib/paths.js";
import {
  currentOmarchyHost,
  ensureHyprHostLink,
  hyprRepoPath,
  resolveLinkTarget,
} from "../lib/omarchyHost.js";
import {
  initCompleteMarker,
  initInProgressMarker,
  writeInitCompleteMarker,
  writeInitInProgressMarker,
} from "../lib/initState.js";
import { ENV, envFlag, envString, setEnv } from "../lib/env.js";
import type { ConfigService } from "../services/Config.js";

const GIT_INCLUDE_PATH = "~/.config/git/config.dotfiles";
const DOCTOR_STARTUP_TIMER_UNIT = "dot-doctor-startup.timer";
const RESUME_MONITOR_SERVICE_UNIT = "dot-on-resume-monitor.service";
const DEFAULT_INIT_OMARCHY_HOST = "desktop";
const INIT_OMARCHY_HOSTS = ["desktop", "laptop"] as const;
const ETC_SHELLS = "/etc/shells";

/** Domain error for first-use init failures. */
class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  message: Schema.String,
}) {}

interface InitOptions {
  readonly confirm: boolean;
  readonly noninteractive: boolean;
  readonly force: boolean;
  readonly branch?: string;
  readonly bootstrapBranch?: string;
  readonly host?: string;
  readonly log?: string;
}

interface InitOptionsDraft {
  confirm: boolean;
  noninteractive: boolean;
  force: boolean;
  branch?: string;
  bootstrapBranch?: string;
  host?: string;
  log?: string;
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
  ["--force", (options) => void (options.force = true)],
]);

const valueInitOptions = new Map<string, ValueInitOptionHandler>([
  ["--branch", (options, value) => void (options.branch = value)],
  [
    "--bootstrap-branch",
    (options, value) => void (options.bootstrapBranch = value),
  ],
  ["--host", (options, value) => void (options.host = value)],
  ["--log", (options, value) => void (options.log = value)],
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
  const gitConfigFile = join(CONFIG_DIR, "git", "config");
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
  if (isManagedSymlink(join(HOME_DIR, ".local", "bin", "dot"), config)) {
    signals.push("managed dot binary symlink (~/.local/bin/dot)");
  }
  if (isManagedSymlink(join(CONFIG_DIR, "git", "config.dotfiles"), config)) {
    signals.push("managed git config symlink (~/.config/git/config.dotfiles)");
  }
  return signals;
}

function assertFreshInitTarget(
  config: ConfigService,
  force: boolean,
): Effect.Effect<void, InitError, OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const completeMarker = initCompleteMarker(config);
    const inProgressMarker = initInProgressMarker(config);

    if (force) {
      yield* log.warn(
        "Forcing init: skipping already-initialised guards (--force)",
      );
      return;
    }

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
    noninteractive: envFlag(ENV.DOT_INIT_NONINTERACTIVE),
    force: false,
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
repos, stow links, mise tools, packages, machine hooks, and then finishes by running
dot update. After init completes, use dot update for ongoing maintenance.

Options:
  --confirm                 Acknowledge non-interactive package helpers
  --noninteractive          Skip interactive prompts for this run
  --interactive             Allow interactive prompts for this run
  --force                   Re-run init even if the machine looks initialised
  --host <name>             Hypr host to link before stow (default: OMARCHY_HOST or desktop)
  --log <path>              Init log path (default: ~/.local/state/dot/init.log)
  --branch <name>           Branch override for non-bootstrap Omarchy repos
  --bootstrap-branch <name> Branch override for bootstrap
  --help, -h                Show this help message

Examples:
  dot init --noninteractive --confirm
  dot init --host laptop --noninteractive --confirm
  dot init --branch main --bootstrap-branch distro/omarchy`);
}

function initOmarchyHost(options: InitOptions): string {
  return (
    options.host?.trim() || currentOmarchyHost() || DEFAULT_INIT_OMARCHY_HOST
  );
}

function shouldPromptForHost(options: InitOptions): boolean {
  return (
    !options.noninteractive && !options.host?.trim() && !currentOmarchyHost()
  );
}

function assertQuestionnaireTty(): Effect.Effect<void, InitError> {
  return process.stdin.isTTY && process.stdout.isTTY
    ? Effect.void
    : fail(
        "Interactive init questionnaire requires a TTY. Pass --noninteractive or --host <name>.",
      );
}

function promptForHost(): Effect.Effect<
  string,
  InitError,
  CommandExecutor | OutputLog
> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    if ((yield* executor.exitCode("which", ["gum"])) !== 0) {
      return yield* fail(
        "Interactive init questionnaire requires gum. Install gum or pass --noninteractive/--host <name>.",
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn(
          [
            "gum",
            "choose",
            "--header",
            "Select Omarchy host for this machine",
            "--selected",
            DEFAULT_INIT_OMARCHY_HOST,
            ...INIT_OMARCHY_HOSTS,
          ],
          {
            stdin: "inherit",
            stdout: "pipe",
            stderr: "inherit",
          },
        );
        const output = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          throw new Error(`gum choose exited ${exitCode}`);
        }
        return output.trim();
      },
      catch: (error) =>
        new InitError({
          message: `Init questionnaire failed: ${error instanceof Error ? error.message : String(error)}`,
        }),
    });
  });
}

function resolveInitOptions(
  options: InitOptions,
): Effect.Effect<InitOptions, InitError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    yield* log.section("Init Questionnaire");

    if (shouldPromptForHost(options)) {
      yield* assertQuestionnaireTty();
      yield* ensureGumInstalled.pipe(
        Effect.mapError((error) => new InitError({ message: error.message })),
      );
      const host = yield* promptForHost();
      yield* log.info(`Selected Hypr host: ${host}`);
      return { ...options, host };
    }

    const host = initOmarchyHost(options);
    yield* log.info(`Using Hypr host: ${host}`);
    return { ...options, host };
  });
}

function persistOmarchyHostEnv(
  host: string,
): Effect.Effect<void, never, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const file = "/etc/environment";
    const line = `OMARCHY_HOST=${host}`;
    // Idempotent: no-op when already correct, otherwise replace any existing
    // OMARCHY_HOST line or append one. pam_env reads /etc/environment at login,
    // so the value reaches the graphical session and every terminal.
    const script = [
      `grep -qx '${line}' ${file} && exit 0`,
      `if grep -q '^OMARCHY_HOST=' ${file}; then`,
      `  sed -i 's|^OMARCHY_HOST=.*|${line}|' ${file}`,
      `else`,
      `  printf '%s\\n' '${line}' >> ${file}`,
      `fi`,
    ].join("\n");

    const exitCode = yield* runElevated("bash", ["-c", script]);
    if (exitCode === 0) {
      yield* log.info(`Persisted ${line} to ${file}`);
    } else {
      yield* log.warn(
        `Could not persist OMARCHY_HOST to ${file} (exit ${exitCode}); set it manually`,
      );
    }
  });
}

function ensureInitHyprHostLink(
  config: ConfigService,
  options: InitOptions,
): Effect.Effect<void, InitError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    if (!config.omarchy.enabled) return;

    const host = initOmarchyHost(options);

    yield* log.section("Omarchy Host Links");
    // Validate the requested host against the stowed package source so a typo
    // fails fast, even on a fresh machine before hypr is stowed.
    const sourceHostDir = join(
      config.publicDotfiles,
      "hypr",
      ".config",
      "hypr",
      "hosts",
      host,
    );
    if (!existsSync(sourceHostDir)) {
      return yield* fail(
        `Unknown Hypr host '${host}': missing ${displayPath(sourceHostDir)}. Pass --host <name> with a configured host.`,
      );
    }

    // Select the host now so host-suffixed stow packages and the Hypr host link
    // resolve correctly during the stow phase.
    setEnv(ENV.OMARCHY_HOST, host);

    // Persist the host for future login sessions so terminals, status scripts,
    // and dot doctor see OMARCHY_HOST without a transient init env.
    yield* persistOmarchyHostEnv(host);

    // The live host directory only exists once hypr is stowed; when it is not
    // there yet, the stow phase creates the host link after stowing.
    const liveHostDir = join(hyprRepoPath(config), "hosts", host);
    if (!existsSync(liveHostDir)) {
      yield* log.info(
        `Hypr host '${host}' selected; host link will be created during stow`,
      );
      return;
    }

    yield* ensureHyprHostLink(config, log, { host });
  });
}

function configureGitInclude(
  config: ConfigService,
): Effect.Effect<void, InitError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const managedConfig = join(CONFIG_DIR, "git", "config.dotfiles");

    yield* log.section("Configure Git");
    if (!existsSync(managedConfig)) {
      if (!config.canUsePrivate) {
        yield* log.warn(
          `Skipping managed Git include (${config.privateReason})`,
        );
        return;
      }

      return yield* fail(
        `Stowed git config.dotfiles not found: ${displayPath(managedConfig)}`,
      );
    }

    if (gitConfigIncludesManagedPath()) {
      yield* log.info("Git config already includes managed dotfiles settings");
      return;
    }

    yield* gitRequired([
      "config",
      "--global",
      "--add",
      "include.path",
      GIT_INCLUDE_PATH,
    ]).pipe(Effect.catchTag("GitCommandError", (error) => fail(error.message)));
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
    const hooksSource = join(CONFIG_DIR, "pacman-hooks");

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

function enableUserUnit(
  unit: string,
  sectionTitle: string,
): Effect.Effect<void, InitError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;
    const unitPath = join(CONFIG_DIR, "systemd", "user", unit);

    yield* log.section(sectionTitle);
    if ((yield* executor.exitCode("which", ["systemctl"])) !== 0) {
      yield* log.warn(`Skipping ${unit} (systemctl not found)`);
      return;
    }

    if (!existsSync(unitPath)) {
      return yield* fail(`Missing systemd user unit: ${displayPath(unitPath)}`);
    }

    yield* runUserSystemctl(["daemon-reload"]);
    yield* runUserSystemctl(["enable", "--now", unit]);
    yield* log.info(`Enabled ${unit}`);
  });
}

function syncAgentsStrict(): Effect.Effect<
  void,
  InitError,
  Config | OutputLog
> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const source =
      envString(ENV.DOT_AGENTS_SYNC_SOURCE) ??
      join(CONFIG_DIR, "opencode", "AGENTS.md");
    if (!existsSync(source)) {
      yield* log.warn(
        `Skipping agents sync; source missing: ${displayPath(source)}`,
      );
      return;
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

    yield* setupPrivateRepo;
    yield* installMissingArchPackages({
      scope: "private",
      confirm: options.confirm,
    });
  });
}

/** Resolve the absolute zsh path on PATH, or null when zsh is not installed. */
function resolveZshPath(): Effect.Effect<
  string | null,
  never,
  CommandExecutor
> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const output = yield* executor
      .run("which", ["zsh"])
      .pipe(Effect.catch(() => Effect.succeed("")));
    const path = output.trim();
    return path.length > 0 ? path : null;
  });
}

/** Read the current user's login shell from the passwd database. */
function currentLoginShell(): Effect.Effect<
  string | null,
  never,
  CommandExecutor
> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const uid = process.getuid?.();
    if (uid === undefined) return null;
    const output = yield* executor
      .run("getent", ["passwd", String(uid)])
      .pipe(Effect.catch(() => Effect.succeed("")));
    const fields = output.trim().split(":");
    return fields.length >= 7 ? fields[6] : null;
  });
}

/** Resolve the current user's login name for chsh. */
function currentUsername(): Effect.Effect<
  string | null,
  never,
  CommandExecutor
> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const output = yield* executor
      .run("id", ["-un"])
      .pipe(Effect.catch(() => Effect.succeed("")));
    const name = output.trim();
    return name.length > 0 ? name : null;
  });
}

/** Whether the given shell path is already registered in /etc/shells. */
function shellRegisteredInEtcShells(shellPath: string): boolean {
  if (!existsSync(ETC_SHELLS)) return false;
  return readFileSync(ETC_SHELLS, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .includes(shellPath);
}

/**
 * Ensure zsh is the user's login shell.
 *
 * Idempotent: registers zsh in /etc/shells only when missing and only runs
 * chsh when the current login shell is not already zsh. Privileged steps use
 * the shared elevated-command pattern. Skips with a warning when zsh is absent.
 */
function ensureLoginShellZsh(): Effect.Effect<
  void,
  InitError,
  CommandExecutor | OutputLog
> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    yield* log.section("Login Shell");

    const zshPath = yield* resolveZshPath();
    if (!zshPath) {
      yield* log.warn("Skipping login shell setup (zsh not found on PATH)");
      return;
    }

    if (!shellRegisteredInEtcShells(zshPath)) {
      const exitCode = yield* runElevated("sh", [
        "-c",
        `echo ${JSON.stringify(zshPath)} >> ${ETC_SHELLS}`,
      ]);
      if (exitCode !== 0) {
        return yield* fail(
          `Failed to register ${zshPath} in ${ETC_SHELLS} (exit ${exitCode})`,
        );
      }
      yield* log.info(`Registered ${zshPath} in ${ETC_SHELLS}`);
    }

    const loginShell = yield* currentLoginShell();
    if (loginShell === zshPath) {
      yield* log.info(`Login shell is already ${zshPath}`);
      return;
    }

    const username = yield* currentUsername();
    if (!username) {
      return yield* fail("Unable to determine current username for chsh");
    }

    const exitCode = yield* runElevated("chsh", ["-s", zshPath, username]);
    if (exitCode !== 0) {
      return yield* fail(`chsh -s ${zshPath} ${username} exited ${exitCode}`);
    }
    yield* log.info(`Set login shell to ${zshPath} for ${username}`);
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
    if (envString(ENV.DOT_LOG_FILE)) {
      yield* log.info(`Init log: ${displayPath(envString(ENV.DOT_LOG_FILE)!)}`);
    }
    yield* assertFreshInitTarget(config, parsed.options.force);
    const options = yield* resolveInitOptions(parsed.options);
    yield* writeInitInProgressMarker(config, options);

    yield* ensureLocalesGenerated;
    yield* syncOmarchyRepos({
      branch: options.branch,
      bootstrapBranch: options.bootstrapBranch,
    });
    yield* ensureInitHyprHostLink(config, options);
    yield* install;
    yield* installMiseTools;
    yield* installMissingArchPackages({
      scope: "public",
      confirm: options.confirm,
    });
    yield* configureFirewallRules;
    yield* installGhExtensions;
    yield* ensureLoginShellZsh();
    yield* setupPrivatePackages(config, options);
    yield* cloneMissingGitConfigRepos({ strict: true, captured: true });
    yield* configureGitInclude(config);
    yield* installPacmanHooks();
    yield* enableUserUnit(
      DOCTOR_STARTUP_TIMER_UNIT,
      "Enable Doctor Startup Timer",
    );
    yield* enableUserUnit(RESUME_MONITOR_SERVICE_UNIT, "Enable Resume Monitor");
    yield* syncAgentsStrict();

    yield* log.section("Final Update");
    yield* update();
    yield* writeInitCompleteMarker(config, "init");
    yield* log.info(
      `Init complete: ${displayPath(initCompleteMarker(config))}`,
    );
  });
}
