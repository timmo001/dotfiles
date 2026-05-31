import { Effect, Schema } from "effect";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { displayPath } from "./omarchyHost.js";
import type { CommandError } from "../services/CommandExecutor.js";
import type { ConfigService } from "../services/Config.js";

/** Domain error for Omarchy repository sync failures. */
class OmarchySyncError extends Schema.TaggedErrorClass<OmarchySyncError>()(
  "OmarchySyncError",
  {
    message: Schema.String,
  },
) {}

/** Branch overrides accepted by first-use Omarchy sync. */
export interface OmarchySyncOptions {
  /** Branch override for non-bootstrap Omarchy repositories. */
  readonly branch?: string;
  /** Branch override for the bootstrap repository. */
  readonly bootstrapBranch?: string;
}

function fail(message: string): Effect.Effect<never, OmarchySyncError> {
  return Effect.fail(new OmarchySyncError({ message }));
}

const REPO_SLUGS: Readonly<Record<string, string>> = {
  bootstrap: "timmo001/bootstrap",
  hypr: "timmo001/omarchy-hypr",
  waybar: "timmo001/omarchy-waybar",
  ghostty: "timmo001/omarchy-ghostty",
  uwsm: "timmo001/omarchy-uwsm",
};

function repoSlug(repoName: string): string | null {
  return REPO_SLUGS[repoName] ?? null;
}

function commandText(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

function commandFailureMessage(
  command: string,
  args: readonly string[],
  error: CommandError,
): string {
  const stderr = error.stderr ? `: ${error.stderr}` : "";
  return `${commandText(command, args)} failed with exit ${error.exitCode}${stderr}`;
}

function runOutput(
  command: string,
  args: readonly string[],
  opts?: { readonly cwd?: string },
): Effect.Effect<string, OmarchySyncError, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    return yield* executor
      .run(command, args, opts)
      .pipe(
        Effect.catchTag("CommandError", (error) =>
          fail(commandFailureMessage(command, args, error)),
        ),
      );
  });
}

function runRequired(
  command: string,
  args: readonly string[],
  opts?: { readonly cwd?: string },
): Effect.Effect<void, OmarchySyncError, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const exitCode = yield* executor.inherit(command, args, opts);
    if (exitCode !== 0) {
      return yield* fail(`${commandText(command, args)} exited ${exitCode}`);
    }
  });
}

function ensureRepoBase(
  config: ConfigService,
): Effect.Effect<void, OmarchySyncError> {
  return Effect.try({
    try: () => mkdirSync(config.omarchy.repoBase, { recursive: true }),
    catch: (error) =>
      new OmarchySyncError({
        message: `Could not create Omarchy repo base ${displayPath(config.omarchy.repoBase)}: ${String(error)}`,
      }),
  });
}

function branchOption(
  opts: OmarchySyncOptions | undefined,
  repoName: string,
): string | undefined {
  return repoName === "bootstrap" ? opts?.bootstrapBranch : opts?.branch;
}

function branchEnvironment(repoName: string): string | undefined {
  return repoName === "bootstrap"
    ? process.env.DOT_BOOTSTRAP_BRANCH
    : process.env.DOT_OMARCHY_BRANCH;
}

function fallbackBranch(config: ConfigService, repoName: string): string {
  return config.omarchy.expectedBranches[repoName] ?? "main";
}

function desiredBranch(
  config: ConfigService,
  opts: OmarchySyncOptions | undefined,
  repoName: string,
): string {
  return (
    branchOption(opts, repoName) ??
    branchEnvironment(repoName) ??
    fallbackBranch(config, repoName)
  );
}

function ensureCleanRepo(
  repoName: string,
  repoPath: string,
): Effect.Effect<void, OmarchySyncError, CommandExecutor> {
  return Effect.gen(function* () {
    const status = (yield* runOutput("git", ["status", "--porcelain"], {
      cwd: repoPath,
    })).trim();
    if (status) {
      return yield* fail(
        `Omarchy repo ${repoName} has local changes: ${displayPath(repoPath)}`,
      );
    }
  });
}

function checkoutBranch(
  repoName: string,
  repoPath: string,
  branch: string,
): Effect.Effect<void, OmarchySyncError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;
    if (!branch) return;

    const remoteBranchExists =
      (yield* executor.exitCode(
        "git",
        ["ls-remote", "--exit-code", "--heads", "origin", branch],
        { cwd: repoPath },
      )) === 0;
    if (!remoteBranchExists) {
      return yield* fail(`Branch '${branch}' not found for ${repoName}`);
    }

    yield* log.info(`Checking out ${repoName} branch '${branch}'`);
    yield* runRequired("git", ["fetch", "origin", branch], { cwd: repoPath });

    const localBranchExists =
      (yield* executor.exitCode(
        "git",
        ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
        { cwd: repoPath },
      )) === 0;

    if (localBranchExists) {
      yield* runRequired("git", ["checkout", branch], { cwd: repoPath });
    } else {
      yield* runRequired(
        "git",
        ["checkout", "-B", branch, `origin/${branch}`],
        {
          cwd: repoPath,
        },
      );
    }

    yield* runRequired(
      "git",
      ["branch", "--set-upstream-to", `origin/${branch}`],
      {
        cwd: repoPath,
      },
    );
  });
}

function syncExistingRepo(
  repoName: string,
  repoPath: string,
  slug: string,
  branch: string,
): Effect.Effect<void, OmarchySyncError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    if (!existsSync(join(repoPath, ".git"))) {
      return yield* fail(
        `Omarchy target exists but is not a git repo: ${displayPath(repoPath)}`,
      );
    }

    const remote = (yield* runOutput("git", ["remote", "get-url", "origin"], {
      cwd: repoPath,
    })).trim();
    if (!remote.includes(slug)) {
      return yield* fail(
        `Omarchy repo ${repoName} remote mismatch (expected ${slug}, found ${remote})`,
      );
    }

    yield* ensureCleanRepo(repoName, repoPath);
    yield* checkoutBranch(repoName, repoPath, branch);
    yield* runRequired("git", ["pull", "--rebase", "--no-edit"], {
      cwd: repoPath,
    });
  });
}

function cloneRepo(
  repoPath: string,
  slug: string,
): Effect.Effect<void, OmarchySyncError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    yield* log.info(`Cloning ${slug} -> ${displayPath(repoPath)}`);
    yield* runRequired("git", [
      "clone",
      `https://github.com/${slug}.git`,
      repoPath,
    ]);
  });
}

function syncRepo(
  config: ConfigService,
  opts: OmarchySyncOptions | undefined,
  repoName: string,
): Effect.Effect<void, OmarchySyncError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const slug = repoSlug(repoName);
    if (!slug) return yield* fail(`Unknown Omarchy repository: ${repoName}`);
    const repoPath = join(config.omarchy.repoBase, repoName);
    const branch = desiredBranch(config, opts, repoName);

    yield* log.section(`Omarchy sync: ${repoName}`);
    if (existsSync(repoPath)) {
      yield* syncExistingRepo(repoName, repoPath, slug, branch);
      return;
    }

    yield* cloneRepo(repoPath, slug);
    yield* checkoutBranch(repoName, repoPath, branch);
  });
}

/** Clone or update the Omarchy repositories required by these dotfiles. */
export function syncOmarchyRepos(
  opts?: OmarchySyncOptions,
): Effect.Effect<void, OmarchySyncError, Config | CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const config = yield* Config;

    if (!config.omarchy.enabled) return;

    yield* ensureRepoBase(config);
    const repoNames = [
      "bootstrap",
      ...config.omarchy.diffRepos.filter(
        (repoName) => repoName !== "bootstrap",
      ),
    ];
    for (const repoName of repoNames) {
      yield* syncRepo(config, opts, repoName);
    }
  });
}
