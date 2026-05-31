import { Effect } from "effect";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
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

function displayPath(path: string): string {
  return path.replace(HOME, "~");
}

function isRoot(): boolean {
  return process.getuid?.() === 0;
}

function elevatedCommand(
  command: string,
  args: readonly string[],
): Effect.Effect<readonly [string, readonly string[]], never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    if (isRoot()) return [command, args] as const;

    if ((yield* executor.exitCode("which", ["pkexec"])) === 0) {
      return ["pkexec", [command, ...args]] as const;
    }

    return ["sudo", [command, ...args]] as const;
  });
}

function runElevated(
  command: string,
  args: readonly string[],
): Effect.Effect<number, never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const [elevated, elevatedArgs] = yield* elevatedCommand(command, args);
    return yield* executor.inherit(elevated, elevatedArgs);
  });
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

function syncPrivatePackageRepoMirror(
  repo: PrivatePackageRepoConfig,
): Effect.Effect<void, never, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;

    yield* log.section("Sync private package repo mirror");
    if (!existsSync(repo.path)) {
      yield* log.warn(
        `Skipping private package repo mirror sync (missing source clone: ${displayPath(repo.path)})`,
      );
      return;
    }

    try {
      mkdirSync(repo.mirrorPath, { recursive: true });
    } catch {
      yield* log.warn(
        `Skipping private package repo mirror sync (cannot create mirror path: ${displayPath(repo.mirrorPath)})`,
      );
      return;
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
      yield* log.warn(
        `Skipping private package repo mirror sync (rsync exited ${exitCode})`,
      );
    }
  });
}

function configurePrivatePacmanRepo(
  repo: PrivatePackageRepoConfig,
): Effect.Effect<void, never, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;

    if (privatePacmanRepoConfigCurrent(repo)) return;

    yield* log.section("Configure private pacman repo");
    const tempPath = join(
      process.env.TMPDIR ?? "/tmp",
      `dot-private-pacman-${process.pid}.conf`,
    );
    writeFileSync(tempPath, privatePackageRepoConfigContents(repo));
    const exitCode = yield* installPrivatePacmanRepoConfig(tempPath);
    removeTempFile(tempPath);
    yield* warnPrivatePacmanRepoConfigInstall(exitCode);
  });
}

function warnPrivatePacmanRepoConfigInstall(
  exitCode: number,
): Effect.Effect<void, never, OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    if (exitCode === 0) return;
    yield* log.warn(
      `Skipping private pacman repo config write (install exited ${exitCode})`,
    );
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

function removeTempFile(tempPath: string): void {
  try {
    unlinkSync(tempPath);
  } catch {
    /* best effort cleanup */
  }
}

function registerPrivatePacmanRepoInclude(): Effect.Effect<
  void,
  never,
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
      yield* log.warn(
        `Skipping private pacman repo include update (cannot write: ${displayPath(privatePacmanMainConfigPath())})`,
      );
    }
  });
}

/** Sync and register the private pacman repository with the active pacman config. */
export const setupPrivateRepo = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;

  if (!config.canUsePrivate) {
    yield* log.error(
      `Private access is not available (${config.privateReason})`,
    );
    process.exitCode = 1;
    return;
  }

  const repo = loadPrivatePackageRepoConfig(config);
  if (!repo) {
    yield* log.error("Missing private package repo config");
    process.exitCode = 1;
    return;
  }

  yield* syncPrivatePackageRepoMirror(repo);
  yield* configurePrivatePacmanRepo(repo);
  yield* registerPrivatePacmanRepoInclude();

  if (privatePackageRepoReady(repo)) {
    yield* log.info(
      `Private pacman repo is configured (${displayPath(privatePacmanRepoConfigPath())})`,
    );
  } else {
    yield* log.warn(
      "Private pacman repo setup incomplete (check /etc permissions)",
    );
  }
});
