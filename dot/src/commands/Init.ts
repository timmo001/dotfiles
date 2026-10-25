import type { Gh } from "@timmo001/effect-gh";
import { Effect, FileSystem, Schema, type PlatformError } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { dirname, join, resolve } from "path";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher } from "../services/Launcher.js";
import { agentsSync } from "./AgentsSync.js";
import { install } from "./Install.js";
import { gitGlobalIncludes, gitRequired } from "../lib/git.js";
import { checkAppRequirements } from "../lib/packageSetup.js";
import { installGhExtensions } from "../lib/ghExtensions.js";
import { cloneMissingGitConfigRepos } from "../lib/privateGitRepos.js";
import { ensureGlobalHkHooks } from "../lib/gitHooks.js";
import { trustTrackedMiseConfigs } from "../lib/miseTrust.js";
import { withStepTimeout } from "../lib/workflowStep.js";
import { CONFIG_DIR, HOME_DIR, displayPath } from "../lib/paths.js";
import {
  initCompleteMarker,
  initInProgressMarker,
  writeInitCompleteMarker,
  writeInitInProgressMarker,
} from "../lib/initState.js";
import { ENV, envString } from "../lib/env.js";
import { cliStyler } from "../lib/ansi.js";
import { logRunSummary } from "../lib/runSummary.js";
import type { ConfigService } from "../services/Config.js";

const GIT_INCLUDE_PATH = "~/.config/git/config.dotfiles";

/** Upper bound (seconds) for each init phase. */
const INIT_STEP_TIMEOUT_SECONDS = {
  install: 5 * 60,
  gitHooks: 60,
  publicPackages: 60,
  ghExtensions: 5 * 60,
  privatePackages: 60,
  privateRepos: 10 * 60,
  miseTrust: 2 * 60,
  git: 2 * 60,
  agents: 2 * 60,
} as const;

/** Domain error for first-use init failures. */
class InitError extends Schema.TaggedError<InitError>()("InitError", {
  message: Schema.String,
}) {}

/** Typed options supplied by the Effect CLI command. */
export interface InitOptions {
  readonly force: boolean;
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
    Effect.map((target) => resolve(dirname(path), target)),
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

const gitConfigIncludesManagedPath = () => gitGlobalIncludes(GIT_INCLUDE_PATH);

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
): Effect.Effect<
  void,
  InitError,
  CommandExecutor | FileSystem.FileSystem | OutputLog
> {
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
  Config | CommandExecutor | FileSystem.FileSystem | OutputLog
> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;

    if (!config.canUsePrivate) {
      yield* log.warn(
        `Skipping private package setup (${config.privateReason})`,
      );

      return;
    }

    yield* checkAppRequirements({ scope: "private" });
  });
}

/** Run the one-time first-use setup workflow for a fresh machine. */
export function init(
  options: InitOptions,
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

    yield* log.section("Initialization Workflow");

    const logFile = envString(ENV.DOT_LOG_FILE);

    if (logFile) {
      yield* log.info(cliStyler().dim(`Init log: ${displayPath(logFile)}`));
    }

    yield* assertFreshInitTarget(config, options.force);
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
      "Install Dotfiles",
      INIT_STEP_TIMEOUT_SECONDS.install,
      install.pipe(
        Effect.map((actions) => {
          installActions.push(...actions);
        }),
      ),
    );
    yield* step(
      "Install Git Hooks",
      INIT_STEP_TIMEOUT_SECONDS.gitHooks,
      Effect.asVoid(ensureGlobalHkHooks),
    );
    yield* step(
      "Check App Packages And Tools",
      INIT_STEP_TIMEOUT_SECONDS.publicPackages,
      checkAppRequirements({ scope: "public" }),
    );
    yield* step(
      "Install GitHub CLI Extensions",
      INIT_STEP_TIMEOUT_SECONDS.ghExtensions,
      installGhExtensions,
    );
    yield* step(
      "Check Private App Packages",
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
    yield* log.info(`  Run ${style.command("dot doctor")}`);
    yield* log.info(
      `  For ongoing maintenance, run ${style.command("dot update")}`,
    );
  });
}
