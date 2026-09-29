import { Effect, FileSystem, Option } from "effect";
import { join } from "path";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog, type OutputLogService } from "../services/OutputLog.js";
import { cliStyler } from "../lib/ansi.js";
import { elevatedCommand } from "../lib/elevatedCommand.js";
import { gitRequired } from "../lib/git.js";
import { commitIn, hasStagedChanges, pushBranch } from "../git/committer.js";
import { displayPath, expandHomePath } from "../lib/paths.js";
import { ENV, envString } from "../lib/env.js";
import { setupPrivateRepo } from "./SetupPrivateRepo.js";
import { loadPrivatePackageRepoConfig } from "../doctor/checks/packages.js";
import type { ConfigService } from "../services/Config.js";
import type { PrivatePackageRepoConfig } from "../doctor/checks/packages.js";

/** Typed private-package publication input. */
export interface PrivatePkgPublishArgs {
  readonly packageName: string;
  readonly publishGit: boolean;
  readonly buildPackage: boolean;
  readonly installPackage: boolean;
}

function packageMapFile(config: ConfigService): string | null {
  return (
    envString(ENV.DOT_PRIVATE_PACKAGE_MAP_FILE) ??
    (config.privateDotfiles
      ? join(config.privateDotfiles, ".dot-private-package-map")
      : null)
  );
}

const readPrivatePackageMap = Effect.fn("PrivatePkgPublish.readPackageMap")(
  function* (config: ConfigService) {
    const fs = yield* FileSystem.FileSystem;
    const filePath = packageMapFile(config);

    if (!filePath || !(yield* fs.exists(filePath).pipe(Effect.orDie))) {
      return new Map<string, string>();
    }

    const source = yield* fs.readFileString(filePath).pipe(Effect.orDie);

    return new Map(
      source
        .split("\n")
        .map(parsePrivatePackageMapLine)
        .filter((entry) => entry !== null),
    );
  },
);

function parsePrivatePackageMapLine(
  rawLine: string,
): readonly [string, string] | null {
  const line = rawLine.trim();

  if (isBlankOrComment(line)) return null;

  const separator = line.indexOf("=");

  if (separator < 0) return null;

  const key = line.slice(0, separator).trim();
  const value = expandHomePath(line.slice(separator + 1).trim());

  return privatePackageMapEntry(key, value);
}

function isBlankOrComment(line: string): boolean {
  return line.length === 0 || line.startsWith("#");
}

function privatePackageMapEntry(
  key: string,
  value: string,
): readonly [string, string] | null {
  if (!key) return null;

  if (!value) return null;

  return [key, value];
}

const latestRuntimeArtifact = Effect.fn("PrivatePkgPublish.latestArtifact")(
  function* (distDir: string, packageName: string) {
    const fs = yield* FileSystem.FileSystem;

    if (!(yield* fs.exists(distDir).pipe(Effect.orDie))) return null;

    const names = yield* fs.readDirectory(distDir).pipe(Effect.orDie);

    const paths = names
      .filter(
        (name) =>
          name.startsWith(`${packageName}-`) &&
          name.endsWith(".pkg.tar.zst") &&
          !name.includes("-debug-"),
      )
      .map((name) => join(distDir, name));

    const artifacts = yield* Effect.forEach(paths, (path) =>
      fs.stat(path).pipe(
        Effect.map((info) => ({
          path,
          mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
        })),
        Effect.orDie,
      ),
    );

    artifacts.sort((left, right) => {
      const mtimeDelta = left.mtimeMs - right.mtimeMs;

      return mtimeDelta === 0
        ? left.path.localeCompare(right.path)
        : mtimeDelta;
    });

    return artifacts.length > 0 ? artifacts[artifacts.length - 1].path : null;
  },
);

function isRuntimePackageArtifact(
  packageName: string,
  fileName: string,
): boolean {
  return (
    fileName.startsWith(`${packageName}-`) &&
    fileName.endsWith(".pkg.tar.zst") &&
    !fileName.includes("-debug-")
  );
}

const removeRepoSidecars = Effect.fn("PrivatePkgPublish.removeSidecars")(
  function* (repoPath: string) {
    const fs = yield* FileSystem.FileSystem;
    const names = yield* fs.readDirectory(repoPath).pipe(Effect.orDie);

    for (const fileName of names) {
      if (!fileName.endsWith(".old") && !fileName.endsWith(".lck")) continue;
      yield* fs
        .remove(join(repoPath, fileName), { force: true, recursive: true })
        .pipe(Effect.orDie);
    }
  },
);

const removePreviousPackageArtifacts = Effect.fn(
  "PrivatePkgPublish.removePreviousArtifacts",
)(function* (repoPath: string, packageName: string) {
  const fs = yield* FileSystem.FileSystem;
  const names = yield* fs.readDirectory(repoPath).pipe(Effect.orDie);

  for (const fileName of names.filter((name) =>
    shouldRemovePackageArtifact(packageName, name),
  )) {
    yield* fs
      .remove(join(repoPath, fileName), { force: true })
      .pipe(Effect.orDie);
  }
});

function shouldRemovePackageArtifact(
  packageName: string,
  fileName: string,
): boolean {
  return (
    isRuntimePackageArtifact(packageName, fileName) ||
    (fileName.startsWith(`${packageName}-debug-`) &&
      fileName.endsWith(".pkg.tar.zst"))
  );
}

const publishedRuntimeArtifacts = Effect.fn(
  "PrivatePkgPublish.publishedArtifacts",
)(function* (repoPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const names = yield* fs.readDirectory(repoPath).pipe(Effect.orDie);

  return names
    .filter(
      (fileName) =>
        fileName.endsWith(".pkg.tar.zst") && !fileName.includes("-debug-"),
    )
    .sort()
    .map((fileName) => join(repoPath, fileName));
});

function markFailure(
  log: OutputLogService,
  message: string,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    yield* log.error(message);
    process.exitCode = 1;

    return false;
  });
}

function runRequired(
  command: string,
  args: readonly string[],
  opts: { readonly cwd?: string; readonly failureMessage?: string } = {},
): Effect.Effect<boolean, never, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;
    const exitCode = yield* executor.inherit(command, args, { cwd: opts?.cwd });

    if (exitCode === 0) return true;

    return yield* markFailure(
      log,
      opts.failureMessage ?? `${command} exited ${exitCode}`,
    );
  });
}

function supportsDenoPackageArch(
  sourceRepo: string,
): Effect.Effect<boolean, never, CommandExecutor | FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (!(yield* fs.exists(join(sourceRepo, "deno.json")).pipe(Effect.orDie))) {
      return false;
    }

    const executor = yield* CommandExecutor;

    const output = yield* executor
      .run("deno", ["task", "--cwd", sourceRepo])
      .pipe(Effect.orElseSucceed(() => ""));

    return /(^|\s)package:arch($|\s)/.test(output);
  });
}

function buildPackage(
  packageName: string,
  sourceRepo: string,
): Effect.Effect<
  boolean,
  never,
  CommandExecutor | FileSystem.FileSystem | OutputLog
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const log = yield* OutputLog;
    yield* log.section(`Build private package: ${packageName}`);

    if (yield* supportsDenoPackageArch(sourceRepo)) {
      return yield* runRequired("deno", [
        "task",
        "--cwd",
        sourceRepo,
        "package:arch",
      ]);
    }

    if (yield* fs.exists(join(sourceRepo, "Makefile")).pipe(Effect.orDie)) {
      return yield* runRequired("make", ["create_arch"], { cwd: sourceRepo });
    }

    return yield* markFailure(
      log,
      `Missing package build task in ${displayPath(sourceRepo)}`,
    );
  });
}

function publishArtifact(
  repo: PrivatePackageRepoConfig,
  packageName: string,
  runtimePackage: string,
): Effect.Effect<
  boolean,
  never,
  CommandExecutor | FileSystem.FileSystem | OutputLog
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const log = yield* OutputLog;
    yield* log.section(`Publish private package: ${packageName}`);

    if (!(yield* fs.exists(repo.path).pipe(Effect.orDie))) {
      return yield* markFailure(
        log,
        `Missing private package repo clone: ${displayPath(repo.path)}`,
      );
    }

    yield* removePreviousPackageArtifacts(repo.path, packageName);
    yield* fs
      .copyFile(
        runtimePackage,
        join(repo.path, runtimePackage.split("/").pop() ?? packageName),
      )
      .pipe(Effect.orDie);
    yield* removeRepoSidecars(repo.path);

    const artifacts = yield* publishedRuntimeArtifacts(repo.path);

    if (artifacts.length === 0) {
      return yield* markFailure(
        log,
        `No runtime package artifacts found in ${displayPath(repo.path)}`,
      );
    }

    const repoDb = join(repo.path, `${repo.name}.db.tar.gz`);
    const added = yield* runRequired("repo-add", [repoDb, ...artifacts]);
    yield* removeRepoSidecars(repo.path);

    return added;
  });
}

function installPublishedPackage(
  packageName: string,
): Effect.Effect<boolean, never, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const executor = yield* CommandExecutor;
    yield* log.section(`Install private package: ${packageName}`);

    const [command, args] = yield* elevatedCommand("pacman", [
      "-Sy",
      "--noconfirm",
      packageName,
    ]);

    const exitCode = yield* executor.inherit(command, args);

    if (exitCode === 0) return true;

    return yield* markFailure(
      log,
      `${command} ${args.join(" ")} exited ${exitCode}`,
    );
  });
}

function commitAndPushPackageRepo(
  repoPath: string,
  packageName: string,
): Effect.Effect<boolean, never, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    yield* log.section("Commit private package repo");

    if (!(yield* runGitPublishStep(["add", "."], repoPath))) {
      return false;
    }

    if (!(yield* hasStagedChanges(repoPath))) {
      yield* log.info(
        cliStyler().dim("No private package repo changes to commit"),
      );

      return true;
    }

    const message = `publish ${packageName} package`;
    const commit = yield* commitIn({ cwd: repoPath, message });

    if (!commit.ok) {
      return yield* markFailure(log, commit.error ?? "git commit failed");
    }

    yield* log.section("Push private package repo");
    const pushed = yield* pushBranch({ cwd: repoPath });

    if (!pushed.ok) {
      return yield* markFailure(log, pushed.error ?? "git push failed");
    }

    yield* log.success(pushed.message);

    return true;
  });
}

function runGitPublishStep(
  args: readonly string[],
  repoPath: string,
): Effect.Effect<boolean, never, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;

    const gitError = yield* gitRequired(args, { cwd: repoPath }).pipe(
      Effect.map(() => null),
      Effect.catchTag("GitCommandError", (error) =>
        Effect.succeed(error.message),
      ),
    );

    if (!gitError) return true;

    return yield* markFailure(log, gitError);
  });
}

/** Build, publish, optionally install, commit, and push a mapped private package. */
export const privatePkgPublish = (args: PrivatePkgPublishArgs) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const fs = yield* FileSystem.FileSystem;
    const log = yield* OutputLog;

    if (!config.canUsePrivate) {
      yield* markFailure(
        log,
        `Private access is not available (${config.privateReason})`,
      );

      return;
    }

    const repo = yield* loadPrivatePackageRepoConfig(config);

    if (!repo) {
      yield* markFailure(log, "Missing private package repo config");

      return;
    }

    yield* setupPrivateRepo;

    const packageMap = yield* readPrivatePackageMap(config);
    const sourceRepo = packageMap.get(args.packageName);

    if (!sourceRepo) {
      yield* markFailure(
        log,
        `No private package publish mapping configured for: ${args.packageName}`,
      );
      const filePath = packageMapFile(config);

      if (filePath) {
        yield* log.error(
          `Add '${args.packageName} = ~/repos/${args.packageName}' to ${displayPath(filePath)}`,
        );
      }

      return;
    }

    if (!(yield* fs.exists(sourceRepo).pipe(Effect.orDie))) {
      yield* markFailure(
        log,
        `Missing package source repo: ${displayPath(sourceRepo)}`,
      );

      return;
    }

    if (args.buildPackage) {
      if (!(yield* buildPackage(args.packageName, sourceRepo))) return;
    } else {
      yield* log.section(
        `Use existing private package artifact: ${args.packageName}`,
      );
    }

    const distDir = join(sourceRepo, "dist");

    const runtimePackage = yield* latestRuntimeArtifact(
      distDir,
      args.packageName,
    );

    if (!runtimePackage) {
      yield* markFailure(
        log,
        `No runtime package artifact found for ${args.packageName} in ${displayPath(distDir)}`,
      );

      return;
    }

    if (!(yield* publishArtifact(repo, args.packageName, runtimePackage))) {
      return;
    }

    yield* setupPrivateRepo;

    if (args.installPackage) {
      if (!(yield* installPublishedPackage(args.packageName))) return;
    }

    if (args.publishGit) {
      yield* commitAndPushPackageRepo(repo.path, args.packageName);
    }
  });
