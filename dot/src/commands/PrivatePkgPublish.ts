import { Effect } from "effect";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog, type OutputLogService } from "../services/OutputLog.js";
import { elevatedCommand } from "../lib/elevatedCommand.js";
import { setupPrivateRepo } from "./SetupPrivateRepo.js";
import { loadPrivatePackageRepoConfig } from "../doctor/checks/packages.js";
import type { ConfigService } from "../services/Config.js";
import type { PrivatePackageRepoConfig } from "../doctor/checks/packages.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;

interface PrivatePkgPublishArgs {
  readonly packageName: string;
  readonly publishGit: boolean;
  readonly buildPackage: boolean;
  readonly installPackage: boolean;
}

interface PrivatePkgPublishArgDraft {
  packageName: string;
  publishGit: boolean;
  buildPackage: boolean;
  installPackage: boolean;
}

type ParsedPrivatePkgPublishArgs =
  | { readonly type: "args"; readonly args: PrivatePkgPublishArgs }
  | { readonly type: "help" }
  | { readonly type: "error"; readonly message: string };

type ParseArgResult =
  | { readonly type: "continue" }
  | ParsedPrivatePkgPublishArgs;

const PRIVATE_PKG_PUBLISH_USAGE =
  "Usage: dot private-pkg-publish [--no-git] [--skip-build] [--install] <package-name>";

const privatePkgOptionHandlers = new Map<
  string,
  (draft: PrivatePkgPublishArgDraft) => void
>([
  ["--no-git", (draft) => void (draft.publishGit = false)],
  ["--skip-build", (draft) => void (draft.buildPackage = false)],
  ["--install", (draft) => void (draft.installPackage = true)],
]);

function displayPath(path: string): string {
  return path.replace(HOME, "~");
}

function expandHomePath(path: string): string {
  return path.replace(/^~(?=\/|$)/, HOME);
}

function packageMapFile(config: ConfigService): string | null {
  return (
    process.env.DOT_PRIVATE_PACKAGE_MAP_FILE ??
    (config.privateDotfiles
      ? join(config.privateDotfiles, ".dot-private-package-map")
      : null)
  );
}

function parsePrivatePkgPublishArgs(
  args: readonly string[],
): ParsedPrivatePkgPublishArgs {
  const draft: PrivatePkgPublishArgDraft = {
    packageName: "",
    publishGit: true,
    buildPackage: true,
    installPackage: false,
  };

  for (const arg of args) {
    const parsed = parsePrivatePkgPublishArg(draft, arg);
    if (parsed.type !== "continue") return parsed;
  }

  if (!draft.packageName) return usageError();

  return {
    type: "args",
    args: draft,
  };
}

function parsePrivatePkgPublishArg(
  draft: PrivatePkgPublishArgDraft,
  arg: string,
): ParseArgResult {
  if (arg === "--help" || arg === "-h") return { type: "help" };

  const optionHandler = privatePkgOptionHandlers.get(arg);
  if (optionHandler) {
    optionHandler(draft);
    return { type: "continue" };
  }

  return parsePrivatePkgPublishPackageArg(draft, arg);
}

function parsePrivatePkgPublishPackageArg(
  draft: PrivatePkgPublishArgDraft,
  arg: string,
): ParseArgResult {
  if (arg.startsWith("-")) {
    return {
      type: "error",
      message: `Unknown private-pkg-publish option: ${arg}`,
    };
  }
  if (draft.packageName) return usageError();
  draft.packageName = arg;
  return { type: "continue" };
}

function usageError(): ParsedPrivatePkgPublishArgs {
  return { type: "error", message: PRIVATE_PKG_PUBLISH_USAGE };
}

function readPrivatePackageMap(
  config: ConfigService,
): ReadonlyMap<string, string> {
  const filePath = packageMapFile(config);
  if (!filePath || !existsSync(filePath)) return new Map();

  return new Map(
    readFileSync(filePath, "utf-8")
      .split("\n")
      .map(parsePrivatePackageMapLine)
      .filter((entry): entry is readonly [string, string] => entry !== null),
  );
}

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

function latestRuntimeArtifact(
  distDir: string,
  packageName: string,
): string | null {
  if (!existsSync(distDir)) return null;

  const artifacts = readdirSync(distDir)
    .filter(
      (name) =>
        name.startsWith(`${packageName}-`) &&
        name.endsWith(".pkg.tar.zst") &&
        !name.includes("-debug-"),
    )
    .map((name) => join(distDir, name))
    .sort((left, right) => {
      const mtimeDelta = statSync(left).mtimeMs - statSync(right).mtimeMs;
      return mtimeDelta === 0 ? left.localeCompare(right) : mtimeDelta;
    });

  return artifacts.length > 0 ? artifacts[artifacts.length - 1] : null;
}

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

function removeRepoSidecars(repoPath: string): void {
  for (const fileName of readdirSync(repoPath)) {
    if (!fileName.endsWith(".old") && !fileName.endsWith(".lck")) continue;
    rmSync(join(repoPath, fileName), { force: true, recursive: true });
  }
}

function removePreviousPackageArtifacts(
  repoPath: string,
  packageName: string,
): void {
  for (const fileName of readdirSync(repoPath).filter((name) =>
    shouldRemovePackageArtifact(packageName, name),
  )) {
    rmSync(join(repoPath, fileName), { force: true });
  }
}

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

function publishedRuntimeArtifacts(repoPath: string): readonly string[] {
  return readdirSync(repoPath)
    .filter(
      (fileName) =>
        fileName.endsWith(".pkg.tar.zst") && !fileName.includes("-debug-"),
    )
    .sort()
    .map((fileName) => join(repoPath, fileName));
}

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
): Effect.Effect<boolean, never, CommandExecutor> {
  return Effect.gen(function* () {
    if (!existsSync(join(sourceRepo, "deno.json"))) return false;
    const executor = yield* CommandExecutor;
    const output = yield* executor
      .run("deno", ["task", "--cwd", sourceRepo])
      .pipe(Effect.catch(() => Effect.succeed("")));
    return /(^|\s)package:arch($|\s)/.test(output);
  });
}

function buildPackage(
  packageName: string,
  sourceRepo: string,
): Effect.Effect<boolean, never, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
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

    if (existsSync(join(sourceRepo, "Makefile"))) {
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
): Effect.Effect<boolean, never, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    yield* log.section(`Publish private package: ${packageName}`);

    if (!existsSync(repo.path)) {
      return yield* markFailure(
        log,
        `Missing private package repo clone: ${displayPath(repo.path)}`,
      );
    }

    removePreviousPackageArtifacts(repo.path, packageName);
    copyFileSync(
      runtimePackage,
      join(repo.path, runtimePackage.split("/").pop() ?? packageName),
    );
    removeRepoSidecars(repo.path);

    const artifacts = publishedRuntimeArtifacts(repo.path);
    if (artifacts.length === 0) {
      return yield* markFailure(
        log,
        `No runtime package artifacts found in ${displayPath(repo.path)}`,
      );
    }

    const repoDb = join(repo.path, `${repo.name}.db.tar.gz`);
    const added = yield* runRequired("repo-add", [repoDb, ...artifacts]);
    removeRepoSidecars(repo.path);
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
    if (!(yield* runRequired("git", ["add", "."], { cwd: repoPath }))) {
      return false;
    }

    const executor = yield* CommandExecutor;
    const hasChanges =
      (yield* executor.exitCode("git", ["diff", "--cached", "--quiet"], {
        cwd: repoPath,
      })) !== 0;
    if (!hasChanges) {
      yield* log.info("No private package repo changes to commit");
      return true;
    }

    const message = `publish ${packageName} package`;
    if (
      !(yield* runRequired("git", ["commit", "-m", message], { cwd: repoPath }))
    ) {
      return false;
    }

    yield* log.section("Push private package repo");
    return yield* runRequired("git", ["push"], { cwd: repoPath });
  });
}

function printPrivatePkgPublishHelp(): void {
  console.log(`Usage: dot private-pkg-publish [options] <package-name>

Build and publish a mapped private package into the private pacman repo.

Options:
  --no-git       Skip package repo commit and push
  --skip-build   Publish an existing dist package artifact
  --install      Install the published package after syncing the mirror
  --help, -h     Show this help message

Examples:
  dot private-pkg-publish twitch-notifications --install
  dot private-pkg-publish --skip-build --no-git twitch-notifications`);
}

/** Build, publish, optionally install, commit, and push a mapped private package. */
// fallow-ignore-next-line complexity
export const privatePkgPublish = (rawArgs: readonly string[]) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const parsed = parsePrivatePkgPublishArgs(rawArgs);

    if (parsed.type === "help") {
      printPrivatePkgPublishHelp();
      return;
    }

    if (parsed.type === "error") {
      yield* markFailure(log, parsed.message);
      return;
    }

    if (!config.canUsePrivate) {
      yield* markFailure(
        log,
        `Private access is not available (${config.privateReason})`,
      );
      return;
    }

    const repo = loadPrivatePackageRepoConfig(config);
    if (!repo) {
      yield* markFailure(log, "Missing private package repo config");
      return;
    }
    yield* setupPrivateRepo;

    const packageMap = readPrivatePackageMap(config);
    const sourceRepo = packageMap.get(parsed.args.packageName);
    if (!sourceRepo) {
      yield* markFailure(
        log,
        `No private package publish mapping configured for: ${parsed.args.packageName}`,
      );
      const filePath = packageMapFile(config);
      if (filePath) {
        yield* log.error(
          `Add '${parsed.args.packageName} = ~/repos/${parsed.args.packageName}' to ${displayPath(filePath)}`,
        );
      }
      return;
    }

    if (!existsSync(sourceRepo)) {
      yield* markFailure(
        log,
        `Missing package source repo: ${displayPath(sourceRepo)}`,
      );
      return;
    }

    if (parsed.args.buildPackage) {
      if (!(yield* buildPackage(parsed.args.packageName, sourceRepo))) return;
    } else {
      yield* log.section(
        `Use existing private package artifact: ${parsed.args.packageName}`,
      );
    }

    const distDir = join(sourceRepo, "dist");
    const runtimePackage = latestRuntimeArtifact(
      distDir,
      parsed.args.packageName,
    );
    if (!runtimePackage) {
      yield* markFailure(
        log,
        `No runtime package artifact found for ${parsed.args.packageName} in ${displayPath(distDir)}`,
      );
      return;
    }

    if (
      !(yield* publishArtifact(repo, parsed.args.packageName, runtimePackage))
    ) {
      return;
    }

    yield* setupPrivateRepo;

    if (parsed.args.installPackage) {
      if (!(yield* installPublishedPackage(parsed.args.packageName))) return;
    }

    if (parsed.args.publishGit) {
      yield* commitAndPushPackageRepo(repo.path, parsed.args.packageName);
    }
  });
