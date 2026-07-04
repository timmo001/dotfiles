import { Effect, Schema } from "effect";
import { existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import {
  ghRepoCloneCaptured,
  gitExitCode,
  gitOutput,
  gitRemoteOutput,
  gitWorkingTreeClean,
  isGitRepo,
} from "./git.js";
import { displayPath } from "./paths.js";
import { ENV, envString } from "./env.js";
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
  /** Branch override for Omarchy repositories. */
  readonly branch?: string;
}

function fail(message: string): Effect.Effect<never, OmarchySyncError> {
  return Effect.fail(new OmarchySyncError({ message }));
}

const REPO_SLUGS: Readonly<Record<string, string>> = {
  uwsm: "timmo001/omarchy-uwsm",
};

function repoSlug(repoName: string): string | null {
  return REPO_SLUGS[repoName] ?? null;
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

function backupPath(repoPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${repoPath}.dot-init-backup-${timestamp}`;
}

function backupExistingTarget(
  repoName: string,
  repoPath: string,
): Effect.Effect<void, OmarchySyncError, OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const target = backupPath(repoPath);
    yield* log.warn(
      `Moving existing non-git Omarchy ${repoName} config to ${displayPath(target)}`,
    );
    yield* Effect.try({
      try: () => renameSync(repoPath, target),
      catch: (error) =>
        new OmarchySyncError({
          message: `Could not back up existing Omarchy target ${displayPath(repoPath)}: ${String(error)}`,
        }),
    });
  });
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
    opts?.branch ??
    envString(ENV.DOT_OMARCHY_BRANCH) ??
    fallbackBranch(config, repoName)
  );
}

function ensureCleanRepo(
  repoName: string,
  repoPath: string,
): Effect.Effect<void, OmarchySyncError, CommandExecutor> {
  return Effect.gen(function* () {
    const clean = yield* gitWorkingTreeClean(repoPath).pipe(
      Effect.catchTag("GitCommandError", (error) => fail(error.message)),
    );
    if (!clean) {
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
    const log = yield* OutputLog;
    if (!branch) return;

    const remoteBranch = yield* gitRemoteOutput(
      ["ls-remote", "--exit-code", "--heads", "origin", branch],
      { cwd: repoPath },
    ).pipe(Effect.catchTag("GitCommandError", () => Effect.succeed("")));
    if (!remoteBranch) {
      return yield* fail(`Branch '${branch}' not found for ${repoName}`);
    }

    yield* log.info(`Checking out ${repoName} branch '${branch}'`);
    yield* gitRemoteOutput(["fetch", "origin", branch], { cwd: repoPath }).pipe(
      Effect.asVoid,
      Effect.catchTag("GitCommandError", (error) => fail(error.message)),
    );

    const localBranchExists =
      (yield* gitExitCode(
        ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
        { cwd: repoPath },
      )) === 0;

    if (localBranchExists) {
      yield* gitOutput(["checkout", branch], { cwd: repoPath }).pipe(
        Effect.asVoid,
        Effect.catchTag("GitCommandError", (error) => fail(error.message)),
      );
    } else {
      yield* gitOutput(["checkout", "-B", branch, `origin/${branch}`], {
        cwd: repoPath,
      }).pipe(
        Effect.asVoid,
        Effect.catchTag("GitCommandError", (error) => fail(error.message)),
      );
    }

    yield* gitOutput(["branch", "--set-upstream-to", `origin/${branch}`], {
      cwd: repoPath,
    }).pipe(
      Effect.asVoid,
      Effect.catchTag("GitCommandError", (error) => fail(error.message)),
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

    const remote = (yield* gitOutput(["remote", "get-url", "origin"], {
      cwd: repoPath,
    }).pipe(
      Effect.catchTag("GitCommandError", (error) => fail(error.message)),
    )).trim();
    if (!remote.includes(slug)) {
      return yield* fail(
        `Omarchy repo ${repoName} remote mismatch (expected ${slug}, found ${remote})`,
      );
    }

    yield* ensureCleanRepo(repoName, repoPath);
    yield* checkoutBranch(repoName, repoPath, branch);
    yield* gitRemoteOutput(["pull", "--rebase", "--no-edit"], {
      cwd: repoPath,
    }).pipe(
      Effect.asVoid,
      Effect.catchTag("GitCommandError", (error) => fail(error.message)),
    );
  });
}

function cloneRepo(
  repoPath: string,
  slug: string,
): Effect.Effect<void, OmarchySyncError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    yield* log.info(`Cloning ${slug} -> ${displayPath(repoPath)}`);
    yield* ghRepoCloneCaptured(slug, repoPath).pipe(
      Effect.catchTag("GitCommandError", (error) => fail(error.message)),
    );
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

    yield* log.withSpinner(
      `Syncing Omarchy ${repoName}`,
      Effect.gen(function* () {
        if (existsSync(repoPath)) {
          if (!isGitRepo(repoPath)) {
            yield* backupExistingTarget(repoName, repoPath);
            yield* cloneRepo(repoPath, slug);
            yield* checkoutBranch(repoName, repoPath, branch);
            return;
          }

          yield* syncExistingRepo(repoName, repoPath, slug, branch);
          return;
        }

        yield* cloneRepo(repoPath, slug);
        yield* checkoutBranch(repoName, repoPath, branch);
      }),
    );
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
    for (const repoName of config.omarchy.diffRepos) {
      yield* syncRepo(config, opts, repoName);
    }
  });
}
