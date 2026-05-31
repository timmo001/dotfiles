import { Effect, Schema } from "effect";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { runElevated } from "../lib/elevatedCommand.js";
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

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;

/** Domain error for private pacman repository setup failures. */
class SetupPrivateRepoError extends Schema.TaggedErrorClass<SetupPrivateRepoError>()(
  "SetupPrivateRepoError",
  {
    message: Schema.String,
  },
) {}

function displayPath(path: string): string {
  return path.replace(HOME, "~");
}

function privatePackageRepoReady(repo: PrivatePackageRepoConfig): boolean {
  return (
    privatePackageRepoRegistered(repo) &&
    privatePackageRepoIncludeRegistered() &&
    privatePackageRepoConfigMatches(repo)
  );
}

function privatePacmanRepoConfigCurrent(
  repo: PrivatePackageRepoConfig,
): boolean {
  return (
    privatePackageRepoRegistered(repo) && privatePackageRepoConfigMatches(repo)
  );
}

function fail(message: string): Effect.Effect<never, SetupPrivateRepoError> {
  return Effect.fail(new SetupPrivateRepoError({ message }));
}

function removeTempFile(
  tempPath: string,
): Effect.Effect<void, SetupPrivateRepoError> {
  return Effect.try({
    try: () => unlinkSync(tempPath),
    catch: (error) =>
      new SetupPrivateRepoError({
        message: `Could not remove temp file ${displayPath(tempPath)}: ${String(error)}`,
      }),
  });
}

function writeTempPrivatePacmanRepoConfig(
  repo: PrivatePackageRepoConfig,
): Effect.Effect<string, SetupPrivateRepoError> {
  return Effect.try({
    try: () => {
      const tempPath = join(
        process.env.TMPDIR ?? "/tmp",
        `dot-private-pacman-${process.pid}.conf`,
      );
      writeFileSync(tempPath, privatePackageRepoConfigContents(repo));
      return tempPath;
    },
    catch: (error) =>
      new SetupPrivateRepoError({
        message: `Could not write private pacman repo temp config: ${String(error)}`,
      }),
  });
}

/** Sync the private package repository mirror consumed by pacman. */
function syncPrivatePackageRepoMirror(
  repo: PrivatePackageRepoConfig,
): Effect.Effect<void, SetupPrivateRepoError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;

    yield* log.section("Sync private package repo mirror");
    if (!existsSync(repo.path)) {
      return yield* fail(
        `Missing private package repo source clone: ${displayPath(repo.path)}`,
      );
    }

    try {
      mkdirSync(repo.mirrorPath, { recursive: true });
    } catch (error) {
      return yield* fail(
        `Cannot create private package repo mirror path ${displayPath(repo.mirrorPath)}: ${String(error)}`,
      );
    }

    const exitCode = yield* executor.inherit("rsync", [
      "-a",
      "--delete",
      "--exclude",
      ".git/",
      `${repo.path}/`,
      `${repo.mirrorPath}/`,
    ]);
    if (exitCode !== 0) {
      return yield* fail(
        `rsync private package repo mirror exited ${exitCode}`,
      );
    }
  });
}

/** Write the private pacman repository snippet when it is missing or outdated. */
function configurePrivatePacmanRepo(
  repo: PrivatePackageRepoConfig,
): Effect.Effect<void, SetupPrivateRepoError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;

    if (privatePacmanRepoConfigCurrent(repo)) return;

    yield* log.section("Configure private pacman repo");
    const tempPath = yield* writeTempPrivatePacmanRepoConfig(repo);
    const exitCode = yield* installPrivatePacmanRepoConfig(tempPath);
    yield* removeTempFile(tempPath);
    if (exitCode !== 0) {
      return yield* fail(
        `Could not install private pacman repo config (install exited ${exitCode})`,
      );
    }
  });
}

function installPrivatePacmanRepoConfig(
  tempPath: string,
): Effect.Effect<number, never, CommandExecutor> {
  return runElevated("install", [
    "-D",
    "-m",
    "0644",
    tempPath,
    privatePacmanRepoConfigPath(),
  ]);
}

/** Register the private pacman repository snippet from the main pacman config. */
function registerPrivatePacmanRepoInclude(): Effect.Effect<
  void,
  SetupPrivateRepoError,
  CommandExecutor | OutputLog
> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    if (privatePackageRepoIncludeRegistered()) return;

    yield* log.section("Register private pacman repo include");
    const exitCode = yield* runElevated("sh", [
      "-c",
      'printf "\\n%s\\n" "$1" >> "$2"',
      "sh",
      privatePackageRepoIncludeLine(),
      privatePacmanMainConfigPath(),
    ]);
    if (exitCode !== 0) {
      return yield* fail(
        `Could not write private pacman repo include to ${displayPath(privatePacmanMainConfigPath())} (exit ${exitCode})`,
      );
    }
  });
}

/** Sync and register a loaded private package repository config. */
export const setupPrivatePackageRepo = (
  repo: PrivatePackageRepoConfig,
): Effect.Effect<void, SetupPrivateRepoError, CommandExecutor | OutputLog> =>
  Effect.gen(function* () {
    yield* syncPrivatePackageRepoMirror(repo);
    yield* configurePrivatePacmanRepo(repo);
    yield* registerPrivatePacmanRepoInclude();

    if (!privatePackageRepoReady(repo)) {
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

  const repo = loadPrivatePackageRepoConfig(config);
  if (!repo) {
    return yield* fail("Missing private package repo config");
  }

  yield* setupPrivatePackageRepo(repo);
  yield* log.info(
    `Private pacman repo is configured (${displayPath(privatePacmanRepoConfigPath())})`,
  );
});
