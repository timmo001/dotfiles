import type { Gh } from "@timmo001/effect-gh";
import { Effect, FileSystem, Option, Schema } from "effect";
import { join } from "path";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { runElevated } from "../lib/elevatedCommand.js";
import { ghRepoCloneCaptured } from "../lib/git.js";
import { withSpinnerTimeout, withStepTimeout } from "../lib/workflowStep.js";
import { displayPath } from "../lib/paths.js";
import { ENV, envString } from "../lib/env.js";
import {
  loadPrivatePackageRepoConfig,
  privatePackageRepoConfigContents,
  privatePackageRepoConfigMatches,
  privatePackageRepoIncludeLine,
  privatePackageRepoIncludeRegistered,
  privatePackageRepoRegistered,
  privatePacmanMainConfigPath,
  privatePacmanRepoConfigPath,
} from "../doctor/checks/packages.js";
import type { PrivatePackageRepoConfig } from "../doctor/checks/packages.js";

const PRIVATE_PACKAGE_REPO_CLONE_TIMEOUT_SECONDS = 3 * 60;

const PRIVATE_PACKAGE_REPO_MKDIR_TIMEOUT_SECONDS = 60;

const PRIVATE_PACKAGE_REPO_RSYNC_TIMEOUT_SECONDS = 5 * 60;

const PRIVATE_PACKAGE_REPO_CONFIG_TIMEOUT_SECONDS = 60;

const PRIVATE_PACKAGE_REPO_REFRESH_TIMEOUT_SECONDS = 5 * 60;

/** Domain error for private pacman repository setup failures. */
class SetupPrivateRepoError extends Schema.TaggedError<SetupPrivateRepoError>()(
  "SetupPrivateRepoError",
  {
    message: Schema.String,
  },
) {}

const privatePackageRepoReady = Effect.fn("SetupPrivateRepo.repoReady")(
  function* (repo: PrivatePackageRepoConfig) {
    return (
      (yield* privatePackageRepoRegistered(repo)) &&
      (yield* privatePackageRepoIncludeRegistered()) &&
      (yield* privatePackageRepoConfigMatches(repo))
    );
  },
);

const privatePackageMirrorHasDatabase = Effect.fn(
  "SetupPrivateRepo.mirrorHasDatabase",
)(function* (repo: PrivatePackageRepoConfig) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readDirectory(repo.mirrorPath).pipe(
    Effect.map((entries) =>
      entries.some(
        (entry) =>
          entry === `${repo.name}.db` ||
          entry === `${repo.name}.db.tar.gz` ||
          entry === `${repo.name}.db.tar.zst`,
      ),
    ),
    Effect.orElseSucceed(() => false),
  );
});

const privatePackageRepoInstalled = Effect.fn("SetupPrivateRepo.installed")(
  function* (repo: PrivatePackageRepoConfig) {
    return (
      (yield* privatePackageMirrorHasDatabase(repo)) &&
      (yield* privatePackageRepoRegistered(repo)) &&
      (yield* privatePackageRepoIncludeRegistered()) &&
      (yield* privatePackageRepoConfigMatches(repo))
    );
  },
);

const privatePacmanRepoConfigCurrent = Effect.fn(
  "SetupPrivateRepo.repoConfigCurrent",
)(function* (repo: PrivatePackageRepoConfig) {
  return (
    (yield* privatePackageRepoRegistered(repo)) &&
    (yield* privatePackageRepoConfigMatches(repo))
  );
});

const pathExists = (fs: FileSystem.FileSystem, path: string) =>
  fs
    .exists(path)
    .pipe(
      Effect.mapError(
        (error) => new SetupPrivateRepoError({ message: error.message }),
      ),
    );

function fail(message: string): Effect.Effect<never, SetupPrivateRepoError> {
  return Effect.fail(new SetupPrivateRepoError({ message }));
}

function runPrivateRepoStep<R>(
  label: string,
  seconds: number,
  step: Effect.Effect<void, SetupPrivateRepoError, R>,
): Effect.Effect<void, SetupPrivateRepoError, R | OutputLog> {
  return Effect.gen(function* () {
    const completed = yield* withStepTimeout(label, seconds, step);

    if (!completed) {
      return yield* fail(
        `Private package repo step timed out after ${seconds}s: ${label}`,
      );
    }
  });
}

function runElevatedPrivateRepoCommand(
  label: string,
  seconds: number,
  command: string,
  args: readonly string[],
  failureMessage: (exitCode: number) => string,
): Effect.Effect<void, SetupPrivateRepoError, CommandExecutor | OutputLog> {
  return runPrivateRepoStep(
    label,
    seconds,
    Effect.gen(function* () {
      const exitCode = yield* runElevated(command, args);

      if (exitCode !== 0) return yield* fail(failureMessage(exitCode));
    }),
  );
}

function removePartialClone(
  repo: PrivatePackageRepoConfig,
): Effect.Effect<void, SetupPrivateRepoError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* fs.remove(repo.path, { recursive: true, force: true }).pipe(
      Effect.mapError(
        (error) =>
          new SetupPrivateRepoError({
            message: `Could not remove partial private package repo clone ${displayPath(repo.path)}: ${String(error)}`,
          }),
      ),
    );
  });
}

function clonePrivatePackageRepo(
  repo: PrivatePackageRepoConfig,
): Effect.Effect<
  void,
  SetupPrivateRepoError,
  FileSystem.FileSystem | Gh | OutputLog
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (yield* pathExists(fs, repo.path)) return;

    if (!repo.remote) {
      return yield* fail(
        `Missing private package repo source clone: ${displayPath(repo.path)}`,
      );
    }

    const cloned = yield* withSpinnerTimeout(
      `Clone private package repo to ${displayPath(repo.path)}`,
      PRIVATE_PACKAGE_REPO_CLONE_TIMEOUT_SECONDS,
      ghRepoCloneCaptured(repo.remote, repo.path, ["--depth", "1"]).pipe(
        Effect.catchTag("GitCommandError", (error) =>
          removePartialClone(repo).pipe(
            Effect.ignore,
            Effect.flatMap(() => fail(error.message)),
          ),
        ),
      ),
    );

    if (Option.isNone(cloned)) {
      yield* removePartialClone(repo).pipe(Effect.ignore);

      return yield* fail(
        `Private package repo clone timed out after ${PRIVATE_PACKAGE_REPO_CLONE_TIMEOUT_SECONDS}s`,
      );
    }
  });
}

function removeTempFile(
  tempPath: string,
): Effect.Effect<void, SetupPrivateRepoError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* fs.remove(tempPath).pipe(
      Effect.mapError(
        (error) =>
          new SetupPrivateRepoError({
            message: `Could not remove temp file ${displayPath(tempPath)}: ${String(error)}`,
          }),
      ),
    );
  });
}

function writeTempPrivatePacmanRepoConfig(
  repo: PrivatePackageRepoConfig,
): Effect.Effect<string, SetupPrivateRepoError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const tempPath = join(
      envString(ENV.TMPDIR) ?? "/tmp",
      `dot-private-pacman-${process.pid}.conf`,
    );

    yield* fs
      .writeFileString(tempPath, privatePackageRepoConfigContents(repo))
      .pipe(
        Effect.mapError(
          (error) =>
            new SetupPrivateRepoError({
              message: `Could not write private pacman repo temp config: ${String(error)}`,
            }),
        ),
      );

    return tempPath;
  });
}

/** Sync the private package repository mirror consumed by pacman. */
function syncPrivatePackageRepoMirror(
  repo: PrivatePackageRepoConfig,
): Effect.Effect<
  void,
  SetupPrivateRepoError,
  CommandExecutor | FileSystem.FileSystem | OutputLog
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const log = yield* OutputLog;

    yield* log.section("Sync private package repo mirror");

    if (!(yield* pathExists(fs, repo.path))) {
      return yield* fail(
        `Missing private package repo source clone: ${displayPath(repo.path)}`,
      );
    }

    yield* log.info(`Source: ${displayPath(repo.path)}`);
    yield* log.info(`Mirror: ${displayPath(repo.mirrorPath)}`);
    yield* runElevatedPrivateRepoCommand(
      "Create private package repo mirror directory",
      PRIVATE_PACKAGE_REPO_MKDIR_TIMEOUT_SECONDS,
      "install",
      ["-d", "-m", "0755", repo.mirrorPath],
      (exitCode) =>
        `Cannot create private package repo mirror path ${displayPath(repo.mirrorPath)} (install exited ${exitCode})`,
    );
    yield* runElevatedPrivateRepoCommand(
      "Sync private package repo mirror files",
      PRIVATE_PACKAGE_REPO_RSYNC_TIMEOUT_SECONDS,
      "rsync",
      [
        "-a",
        "--delete",
        "--exclude",
        ".git/",
        `${repo.path}/`,
        `${repo.mirrorPath}/`,
      ],
      (exitCode) => `rsync private package repo mirror exited ${exitCode}`,
    );
  });
}

/** Write the private pacman repository snippet when it is missing or outdated. */
function configurePrivatePacmanRepo(
  repo: PrivatePackageRepoConfig,
): Effect.Effect<
  void,
  SetupPrivateRepoError,
  CommandExecutor | FileSystem.FileSystem | OutputLog
> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;

    if (yield* privatePacmanRepoConfigCurrent(repo)) return;

    yield* log.section("Configure private pacman repo");
    const tempPath = yield* writeTempPrivatePacmanRepoConfig(repo);
    yield* runElevatedPrivateRepoCommand(
      "Install private pacman repo config",
      PRIVATE_PACKAGE_REPO_CONFIG_TIMEOUT_SECONDS,
      "install",
      ["-D", "-m", "0644", tempPath, privatePacmanRepoConfigPath()],
      (exitCode) =>
        `Could not install private pacman repo config (install exited ${exitCode})`,
    ).pipe(Effect.ensuring(removeTempFile(tempPath).pipe(Effect.ignore)));
  });
}

/** Refresh pacman's cached repository metadata after syncing the local mirror. */
function refreshPrivatePacmanMetadata(): Effect.Effect<
  void,
  SetupPrivateRepoError,
  CommandExecutor | OutputLog
> {
  return runElevatedPrivateRepoCommand(
    "Refresh pacman package databases",
    PRIVATE_PACKAGE_REPO_REFRESH_TIMEOUT_SECONDS,
    "pacman",
    ["-Sy", "--noconfirm"],
    (exitCode) =>
      `Could not refresh package databases (pacman exited ${exitCode})`,
  );
}

/** Register the private pacman repository snippet from the main pacman config. */
function registerPrivatePacmanRepoInclude(): Effect.Effect<
  void,
  SetupPrivateRepoError,
  CommandExecutor | OutputLog | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;

    if (yield* privatePackageRepoIncludeRegistered()) return;

    yield* log.section("Register private pacman repo include");
    yield* runElevatedPrivateRepoCommand(
      "Register private pacman repo include",
      PRIVATE_PACKAGE_REPO_CONFIG_TIMEOUT_SECONDS,
      "sh",
      [
        "-c",
        'printf "\\n%s\\n" "$1" >> "$2"',
        "sh",
        privatePackageRepoIncludeLine(),
        privatePacmanMainConfigPath(),
      ],
      (exitCode) =>
        `Could not write private pacman repo include to ${displayPath(privatePacmanMainConfigPath())} (exit ${exitCode})`,
    );
  });
}

/** Sync and register a loaded private package repository config. */
export const setupPrivatePackageRepo = (
  repo: PrivatePackageRepoConfig,
): Effect.Effect<
  void,
  SetupPrivateRepoError,
  CommandExecutor | FileSystem.FileSystem | OutputLog | Gh
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const log = yield* OutputLog;

    if (
      !(yield* pathExists(fs, repo.path)) &&
      (yield* privatePackageRepoInstalled(repo))
    ) {
      yield* log.info(
        "Private pacman repo already configured; skipping source clone",
      );
      yield* refreshPrivatePacmanMetadata();

      return;
    }

    yield* clonePrivatePackageRepo(repo);
    yield* syncPrivatePackageRepoMirror(repo);
    yield* configurePrivatePacmanRepo(repo);
    yield* registerPrivatePacmanRepoInclude();
    yield* refreshPrivatePacmanMetadata();

    if (!(yield* privatePackageRepoReady(repo))) {
      return yield* fail("Private pacman repo setup did not reach ready state");
    }
  });

/** Sync and register the private pacman repository with the active pacman config. */
export const setupPrivateRepo = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;

  if (!config.canUsePrivate) {
    return yield* fail(
      `Private access is not available (${config.privateReason})`,
    );
  }

  const repo = yield* loadPrivatePackageRepoConfig(config);

  if (!repo) {
    return yield* fail("Missing private package repo config");
  }

  yield* setupPrivatePackageRepo(repo);
  yield* log.info(
    `Private pacman repo is configured (${displayPath(privatePacmanRepoConfigPath())})`,
  );
});
