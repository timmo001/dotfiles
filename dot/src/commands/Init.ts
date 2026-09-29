import type { Gh } from "@timmo001/effect-gh";
import {
  Duration,
  Effect,
  FileSystem,
  Predicate,
  Schema,
  Stream,
  type PlatformError,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { basename, join } from "path";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher } from "../services/Launcher.js";
import { agentsSync } from "./AgentsSync.js";
import { install } from "./Install.js";
import { setupPrivateRepo } from "./SetupPrivateRepo.js";
import { setupPublicRepo } from "./SetupPublicRepo.js";
import { runElevated, withSudoKeepAlive } from "../lib/elevatedCommand.js";
import { gitRequired } from "../lib/git.js";
import {
  ensureGumInstalled,
  installMissingArchPackages,
  installMiseTools,
} from "../lib/packageSetup.js";
import { ensureLocalesGenerated } from "../lib/localeSetup.js";
import { configureFirewallRules } from "../lib/firewallSetup.js";
import { installGhExtensions } from "../lib/ghExtensions.js";
import { cloneMissingGitConfigRepos } from "../lib/privateGitRepos.js";
import { trustTrackedMiseConfigs } from "../lib/miseTrust.js";
import { withStepTimeout } from "../lib/workflowStep.js";
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
import { cliStyler } from "../lib/ansi.js";
import { logRunSummary } from "../lib/runSummary.js";
import type { ConfigService } from "../services/Config.js";

const GIT_INCLUDE_PATH = "~/.config/git/config.dotfiles";

const DOCTOR_TIMER_UNIT = "dot-doctor.timer";

const DEFAULT_INIT_OMARCHY_HOST = "desktop";

const INIT_OMARCHY_HOSTS = ["desktop", "laptop"] as const;

const ETC_SHELLS = "/etc/shells";

const OMARCHY_HOST_PERSIST_TIMEOUT_SECONDS = 10;

/** Upper bound (seconds) for each init phase. */
const INIT_STEP_TIMEOUT_SECONDS = {
  locale: 3 * 60,
  hostLinks: 60,
  install: 5 * 60,
  mise: 10 * 60,
  publicPackages: 30 * 60,
  publicRepo: 3 * 60,
  firewall: 3 * 60,
  ghExtensions: 5 * 60,
  loginShell: 2 * 60,
  privatePackages: 30 * 60,
  privateRepos: 10 * 60,
  miseTrust: 2 * 60,
  git: 2 * 60,
  hooks: 2 * 60,
  doctorTimer: 60,
  agents: 2 * 60,
} as const;

/** Domain error for first-use init failures. */
class InitError extends Schema.TaggedError<InitError>()("InitError", {
  message: Schema.String,
}) {}

/** Typed options supplied by the Effect CLI command. */
export interface InitOptions {
  readonly noninteractive: boolean;
  readonly force: boolean;
  readonly host?: string;
  readonly log?: string;
}

function fail(message: string): Effect.Effect<never, InitError> {
  return Effect.fail(new InitError({ message }));
}

const fsError = (error: PlatformError.PlatformError) =>
  new InitError({ message: error.message });

const pathExists = Effect.fn("init.pathExists")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.exists(path).pipe(Effect.mapError(fsError));
});

function requiredInitStep<E, R>(
  label: string,
  seconds: number,
  step: Effect.Effect<void, E, R>,
): Effect.Effect<void, E | InitError, R | OutputLog> {
  return Effect.gen(function* () {
    const completed = yield* withStepTimeout(label, seconds, step);

    if (!completed) return yield* fail(`Init step timed out: ${label}`);
  });
}

const symlinkTarget = Effect.fn("init.symlinkTarget")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readLink(path).pipe(
    Effect.map((target) => resolveLinkTarget(path, target)),
    Effect.orElseSucceed(() => null),
  );
});

function isManagedTarget(target: string, config: ConfigService): boolean {
  if (target.startsWith(config.publicDotfiles)) return true;

  return config.privateDotfiles
    ? target.startsWith(config.privateDotfiles)
    : false;
}

const isManagedSymlink = Effect.fn("init.isManagedSymlink")(function* (
  path: string,
  config: ConfigService,
) {
  const target = yield* symlinkTarget(path);

  return target ? isManagedTarget(target, config) : false;
});

const gitConfigIncludesManagedPath = Effect.fn(
  "init.gitConfigIncludesManagedPath",
)(function* () {
  const fs = yield* FileSystem.FileSystem;
  const gitConfigFile = join(CONFIG_DIR, "git", "config");

  if (!(yield* pathExists(gitConfigFile))) return false;

  const content = yield* fs
    .readFileString(gitConfigFile)
    .pipe(Effect.mapError(fsError));

  return content.includes(`path = ${GIT_INCLUDE_PATH}`);
});

const existingInitSignals = Effect.fn("init.existingInitSignals")(function* (
  config: ConfigService,
) {
  const signals: string[] = [];

  if (yield* gitConfigIncludesManagedPath()) {
    signals.push(`managed git include (${GIT_INCLUDE_PATH})`);
  }

  if (yield* isManagedSymlink(join(HOME_DIR, ".local", "bin", "dot"), config)) {
    signals.push("managed dot binary symlink (~/.local/bin/dot)");
  }

  if (
    yield* isManagedSymlink(join(CONFIG_DIR, "git", "config.dotfiles"), config)
  ) {
    signals.push("managed git config symlink (~/.config/git/config.dotfiles)");
  }

  return signals;
});

function assertFreshInitTarget(
  config: ConfigService,
  force: boolean,
): Effect.Effect<void, InitError, FileSystem.FileSystem | OutputLog> {
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

    if (yield* pathExists(completeMarker)) {
      return yield* fail(
        `dot init has already completed on this machine (${displayPath(completeMarker)}). Use dot update for ongoing maintenance.`,
      );
    }

    if (yield* pathExists(inProgressMarker)) {
      yield* log.warn(
        `Retrying incomplete init attempt (${displayPath(inProgressMarker)})`,
      );

      return;
    }

    const signals = yield* existingInitSignals(config);

    if (signals.length >= 2) {
      return yield* fail(
        `This machine already looks initialised: ${signals.join(", ")}. Use dot update for ongoing maintenance.`,
      );
    }
  });
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
  ChildProcessSpawner.ChildProcessSpawner | CommandExecutor | OutputLog
> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    if ((yield* executor.exitCode("which", ["gum"])) !== 0) {
      return yield* fail(
        "Interactive init questionnaire requires gum. Install gum or pass --noninteractive/--host <name>.",
      );
    }

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    return yield* Effect.gen(function* () {
      const proc = yield* spawner.spawn(
        ChildProcess.make(
          "gum",
          [
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
        ),
      );

      const output = yield* proc.stdout.pipe(
        Stream.decodeText(),
        Stream.mkString,
      );

      const exitCode = yield* proc.exitCode;

      if (exitCode !== 0) {
        return yield* new InitError({
          message: `Init questionnaire failed: gum choose exited ${exitCode}`,
        });
      }

      return output.trim();
    }).pipe(
      Effect.scoped,
      Effect.mapError((error) =>
        Predicate.isTagged(error, "InitError")
          ? error
          : new InitError({
              message: `Init questionnaire failed: ${error.message}`,
            }),
      ),
    );
  });
}

function resolveInitOptions(
  options: InitOptions,
): Effect.Effect<
  InitOptions,
  InitError,
  ChildProcessSpawner.ChildProcessSpawner | CommandExecutor | OutputLog
> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    yield* log.section("Init Questionnaire");

    if (shouldPromptForHost(options)) {
      yield* assertQuestionnaireTty();
      yield* ensureGumInstalled.pipe(
        Effect.mapError((error) => new InitError({ message: error.message })),
      );
      const host = yield* promptForHost();
      yield* log.success(`Selected Hypr host ${cliStyler().accent(host)}`);

      return { ...options, host };
    }

    const host = initOmarchyHost(options);
    yield* log.info(`Using Hypr host ${cliStyler().accent(host)}`);

    return { ...options, host };
  });
}

function persistOmarchyHostEnv(
  host: string,
): Effect.Effect<void, never, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
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

    const persistCommand =
      process.getuid?.() === 0
        ? (["bash", ["-c", script]] as const)
        : (yield* executor.exitCode("which", ["pkexec"])) === 0
          ? (["pkexec", ["bash", "-c", script]] as const)
          : (["sudo", ["-n", "bash", "-c", script]] as const);

    const exitCode = yield* executor
      .exitCode(persistCommand[0], persistCommand[1])
      .pipe(
        Effect.timeout(Duration.seconds(OMARCHY_HOST_PERSIST_TIMEOUT_SECONDS)),
        Effect.orElseSucceed(() => 1),
      );

    if (exitCode === 0) {
      yield* log.success(`Persisted ${line} ${cliStyler().dim(file)}`);
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
): Effect.Effect<
  void,
  InitError,
  CommandExecutor | FileSystem.FileSystem | OutputLog
> {
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

    if (!(yield* pathExists(sourceHostDir))) {
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

    if (!(yield* pathExists(liveHostDir))) {
      yield* log.info(
        cliStyler().dim(
          `Hypr host '${host}' selected; host link will be created during stow`,
        ),
      );

      return;
    }

    yield* ensureHyprHostLink(config, log, { host });
  });
}

function configureGitInclude(
  config: ConfigService,
): Effect.Effect<
  void,
  InitError,
  CommandExecutor | FileSystem.FileSystem | OutputLog
> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const managedConfig = join(CONFIG_DIR, "git", "config.dotfiles");

    yield* log.section("Configure Git");

    if (!(yield* pathExists(managedConfig))) {
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

    if (yield* gitConfigIncludesManagedPath()) {
      yield* log.info(
        cliStyler().dim(
          "Git config already includes managed dotfiles settings",
        ),
      );

      return;
    }

    yield* gitRequired([
      "config",
      "--global",
      "--add",
      "include.path",
      GIT_INCLUDE_PATH,
    ]).pipe(Effect.catchTag("GitCommandError", (error) => fail(error.message)));
    yield* log.success(
      `Added Git config include ${cliStyler().dim(GIT_INCLUDE_PATH)}`,
    );
  });
}

const pacmanHookFiles = Effect.fn("init.pacmanHookFiles")(function* (
  hooksSource: string,
) {
  const fs = yield* FileSystem.FileSystem;

  const names = yield* fs
    .readDirectory(hooksSource)
    .pipe(Effect.mapError(fsError));

  return names.filter((name) => name.endsWith(".hook"));
});

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

    yield* log.success(`Installed ${cliStyler().accent(hookFile)}`);
  });
}

function installPacmanHooks(): Effect.Effect<
  void,
  InitError,
  CommandExecutor | FileSystem.FileSystem | OutputLog
> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const hooksSource = join(CONFIG_DIR, "pacman-hooks");

    yield* log.section("Install Pacman Hooks");

    if (!(yield* pathExists(hooksSource))) {
      yield* log.info(
        cliStyler().dim(
          `No pacman hooks directory found: ${displayPath(hooksSource)}`,
        ),
      );

      return;
    }

    const hookFiles = yield* pacmanHookFiles(hooksSource);

    if (hookFiles.length === 0) {
      yield* log.info(cliStyler().dim("No pacman hooks configured"));

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
): Effect.Effect<
  void,
  InitError,
  CommandExecutor | FileSystem.FileSystem | OutputLog
> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;
    const unitPath = join(CONFIG_DIR, "systemd", "user", unit);

    yield* log.section(sectionTitle);

    if ((yield* executor.exitCode("which", ["systemctl"])) !== 0) {
      yield* log.warn(`Skipping ${unit} (systemctl not found)`);

      return;
    }

    if (!(yield* pathExists(unitPath))) {
      return yield* fail(`Missing systemd user unit: ${displayPath(unitPath)}`);
    }

    yield* runUserSystemctl(["daemon-reload"]);
    yield* runUserSystemctl(["enable", "--now", unit]);
    yield* log.success(`Enabled ${cliStyler().accent(unit)}`);
  });
}

function syncAgentsStrict(): Effect.Effect<
  void,
  unknown,
  Config | FileSystem.FileSystem | OutputLog
> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;

    const source =
      envString(ENV.DOT_AGENTS_SYNC_SOURCE) ??
      join(CONFIG_DIR, "opencode", "AGENTS.md");

    if (!(yield* pathExists(source))) {
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
): Effect.Effect<
  void,
  unknown,
  Config | CommandExecutor | FileSystem.FileSystem | OutputLog | Gh
> {
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
      .pipe(Effect.orElseSucceed(() => ""));

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
      .pipe(Effect.orElseSucceed(() => ""));

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
      .pipe(Effect.orElseSucceed(() => ""));

    const name = output.trim();

    return name.length > 0 ? name : null;
  });
}

/** Whether the given shell path is already registered in /etc/shells. */
const shellRegisteredInEtcShells = Effect.fn("init.shellRegistered")(function* (
  shellPath: string,
) {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* pathExists(ETC_SHELLS))) return false;

  const content = yield* fs
    .readFileString(ETC_SHELLS)
    .pipe(Effect.mapError(fsError));

  return content
    .split("\n")
    .map((line) => line.trim())
    .includes(shellPath);
});

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
  CommandExecutor | FileSystem.FileSystem | OutputLog
> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    yield* log.section("Login Shell");

    const zshPath = yield* resolveZshPath();

    if (!zshPath) {
      yield* log.warn("Skipping login shell setup (zsh not found on PATH)");

      return;
    }

    if (!(yield* shellRegisteredInEtcShells(zshPath))) {
      const exitCode = yield* runElevated("sh", [
        "-c",
        'printf "%s\\n" "$1" >> "$2"',
        "sh",
        zshPath,
        ETC_SHELLS,
      ]);

      if (exitCode !== 0) {
        return yield* fail(
          `Failed to register ${zshPath} in ${ETC_SHELLS} (exit ${exitCode})`,
        );
      }

      yield* log.success(`Registered ${zshPath} in ${ETC_SHELLS}`);
    }

    const loginShell = yield* currentLoginShell();

    if (loginShell === zshPath) {
      yield* log.info(cliStyler().dim(`Login shell is already ${zshPath}`));

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

    yield* log.success(
      `Set login shell to ${cliStyler().accent(zshPath)} for ${username}`,
    );
  });
}

/** Run the one-time first-use setup workflow for a fresh machine. */
export function init(
  input: InitOptions & { readonly interactive: boolean },
): Effect.Effect<
  void,
  unknown,
  | Config
  | ChildProcessSpawner.ChildProcessSpawner
  | CommandExecutor
  | FileSystem.FileSystem
  | OutputLog
  | Launcher
  | Gh
> {
  return Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;

    const optionsInput: InitOptions = {
      ...input,
      noninteractive: input.interactive
        ? false
        : input.noninteractive || envFlag(ENV.DOT_INIT_NONINTERACTIVE),
    };

    yield* log.section("Initialization Workflow");

    const logFile = envString(ENV.DOT_LOG_FILE);

    if (logFile) {
      yield* log.info(cliStyler().dim(`Init log: ${displayPath(logFile)}`));
    }

    yield* assertFreshInitTarget(config, optionsInput.force);
    const options = yield* resolveInitOptions(optionsInput);
    yield* writeInitInProgressMarker(config, options);

    const steps: string[] = [];
    const installActions: string[] = [];

    const step = <E, R>(
      label: string,
      seconds: number,
      effect: Effect.Effect<void, E, R>,
    ) =>
      requiredInitStep(label, seconds, effect).pipe(
        Effect.tap(() => Effect.sync(() => steps.push(label))),
      );

    yield* step(
      "Locale",
      INIT_STEP_TIMEOUT_SECONDS.locale,
      ensureLocalesGenerated,
    );
    yield* step(
      "Omarchy Host Links",
      INIT_STEP_TIMEOUT_SECONDS.hostLinks,
      ensureInitHyprHostLink(config, options),
    );
    yield* step(
      "Install Dotfiles",
      INIT_STEP_TIMEOUT_SECONDS.install,
      install.pipe(
        Effect.map((actions) => {
          installActions.push(...actions);
        }),
      ),
    );
    yield* step(
      "Install Mise Tools",
      INIT_STEP_TIMEOUT_SECONDS.mise,
      installMiseTools,
    );
    yield* step(
      "Setup Public Package Repository",
      INIT_STEP_TIMEOUT_SECONDS.publicRepo,
      setupPublicRepo,
    );
    yield* step(
      "Install Public Packages",
      INIT_STEP_TIMEOUT_SECONDS.publicPackages,
      installMissingArchPackages({
        scope: "public",
      }),
    );
    yield* step(
      "Configure Firewall",
      INIT_STEP_TIMEOUT_SECONDS.firewall,
      configureFirewallRules,
    );
    yield* step(
      "Install GitHub CLI Extensions",
      INIT_STEP_TIMEOUT_SECONDS.ghExtensions,
      installGhExtensions,
    );
    yield* step(
      "Login Shell",
      INIT_STEP_TIMEOUT_SECONDS.loginShell,
      ensureLoginShellZsh(),
    );
    yield* step(
      "Setup Private Packages",
      INIT_STEP_TIMEOUT_SECONDS.privatePackages,
      setupPrivatePackages(config),
    );
    yield* step(
      "Clone Private Git Repositories",
      INIT_STEP_TIMEOUT_SECONDS.privateRepos,
      cloneMissingGitConfigRepos({ strict: true, captured: true }),
    );
    yield* step(
      "Trust Mise Configs",
      INIT_STEP_TIMEOUT_SECONDS.miseTrust,
      trustTrackedMiseConfigs,
    );
    yield* step(
      "Configure Git",
      INIT_STEP_TIMEOUT_SECONDS.git,
      configureGitInclude(config),
    );
    yield* step(
      "Install Pacman Hooks",
      INIT_STEP_TIMEOUT_SECONDS.hooks,
      installPacmanHooks(),
    );
    yield* step(
      "Enable Doctor Timer",
      INIT_STEP_TIMEOUT_SECONDS.doctorTimer,
      enableUserUnit(DOCTOR_TIMER_UNIT, "Enable Doctor Timer"),
    );
    yield* step(
      "Sync Agents",
      INIT_STEP_TIMEOUT_SECONDS.agents,
      syncAgentsStrict(),
    );

    yield* writeInitCompleteMarker(config, "init");

    yield* logRunSummary(
      "Summary",
      steps.flatMap((label) =>
        label === "Install Dotfiles" && installActions.length > 0
          ? installActions
          : [label],
      ),
    );

    const style = cliStyler();

    yield* log.info(
      `Init complete ${style.dim(displayPath(initCompleteMarker(config)))}`,
    );
    yield* log.info("");
    yield* log.info(style.label("Next steps"));
    yield* log.info(
      `  Reboot so the Omarchy session picks up ${style.accent("OMARCHY_HOST")} and stowed user services`,
    );
    yield* log.info(
      `  After reboot, run ${style.command("dot doctor")} to verify this setup`,
    );
    yield* log.info(
      `  For ongoing maintenance, run ${style.command("dot update")}`,
    );
  }).pipe(withSudoKeepAlive);
}
