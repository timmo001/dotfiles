import { Context, Effect, Layer, Schema } from "effect";
import { gitOutput, gitRequired } from "../../lib/git.js";
import { commitIn } from "../committer.js";
import { ENV, envString } from "../../lib/env.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { GitStatusCode, StagedFile } from "../../types.js";

const DEBUG = !!envString(ENV.DOT_DEBUG);
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:GitStaging] ${msg}`);
};

/** Domain error for git staging operations */
export class GitStagingError extends Schema.TaggedErrorClass<GitStagingError>()(
  "GitStagingError",
  {
    message: Schema.String,
  },
) {}

/** Options for {@link GitStagingService.commit}. */
export interface CommitOptions {
  /** Commit subject. Omit under `amend` to keep HEAD's message (`--no-edit`). */
  readonly message?: string;
  /** Pathspecs to scope the commit to; empty commits the staged set. */
  readonly paths?: readonly string[];
  /** Rewrite HEAD via `git commit --amend` instead of creating a new commit. */
  readonly amend?: boolean;
}

/** Service interface for git staging operations scoped to a single repository */
export interface GitStagingService {
  /** Parse `git status --porcelain` output into staged and unstaged file lists */
  readonly getStatus: (
    repoPath: string,
  ) => Effect.Effect<readonly StagedFile[], GitStagingError>;
  /** Stage a single file via `git add` */
  readonly stageFile: (
    repoPath: string,
    file: string,
  ) => Effect.Effect<void, GitStagingError>;
  /** Unstage a single file via `git reset HEAD` */
  readonly unstageFile: (
    repoPath: string,
    file: string,
  ) => Effect.Effect<void, GitStagingError>;
  /** Stage all files via `git add -A` */
  readonly stageAll: (repoPath: string) => Effect.Effect<void, GitStagingError>;
  /**
   * Commit with the given options. When `paths` is provided, the commit is
   * scoped to those pathspecs (`git commit -m <message> -- <paths>`) so only
   * those files are recorded regardless of what else is staged. When `amend`
   * is set the commit rewrites HEAD, and an omitted `message` keeps HEAD's
   * existing message via `--no-edit`.
   */
  readonly commit: (
    repoPath: string,
    options: CommitOptions,
  ) => Effect.Effect<void, GitStagingError>;
  /** Get recent commit messages from a repository */
  readonly getRecentCommits: (
    repoPath: string,
    count: number,
  ) => Effect.Effect<readonly string[], GitStagingError>;
}

/** Effect service for {@link GitStagingService} */
export class GitStaging extends Context.Service<
  GitStaging,
  GitStagingService
>()("GitStaging") {
  static readonly layer = Layer.effect(
    GitStaging,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      const provideExecutor = <A, E>(
        effect: Effect.Effect<A, E, CommandExecutor>,
      ) => effect.pipe(Effect.provideService(CommandExecutor, executor));

      return {
        getStatus: (repoPath) =>
          provideExecutor(runGit(repoPath, ["status", "--porcelain"])).pipe(
            Effect.map((stdout) => {
              const files = stdout
                .split("\n")
                .filter((line) => line.length > 0)
                .flatMap(parseStatusLine);
              log(`Status for ${repoPath}: ${files.length} entries`);
              return files;
            }),
          ),

        stageFile: (repoPath, file) => {
          log(`Staging: ${file}`);
          return provideExecutor(runGitVoid(repoPath, ["add", "--", file]));
        },

        unstageFile: (repoPath, file) => {
          log(`Unstaging: ${file}`);
          return provideExecutor(
            runGitVoid(repoPath, ["reset", "HEAD", "--", file]),
          );
        },

        stageAll: (repoPath) => {
          log(`Staging all in ${repoPath}`);
          return provideExecutor(runGitVoid(repoPath, ["add", "-A"]));
        },

        commit: (repoPath, { message, paths, amend }) => {
          log(
            `${amend ? "Amending" : "Committing"} in ${repoPath}: ${message ?? "(keep message)"}`,
          );
          return provideExecutor(
            commitIn({ cwd: repoPath, message, paths, amend }).pipe(
              Effect.flatMap((outcome) =>
                outcome.ok
                  ? Effect.void
                  : Effect.fail(
                      new GitStagingError({
                        message: outcome.error ?? "git commit failed",
                      }),
                    ),
              ),
            ),
          );
        },

        getRecentCommits: (repoPath, count) =>
          provideExecutor(
            runGit(repoPath, ["log", "--oneline", `-${count}`]),
          ).pipe(
            Effect.map((stdout) =>
              stdout
                .trim()
                .split("\n")
                .filter((line) => line.length > 0)
                .map((line) => {
                  const spaceIdx = line.indexOf(" ");
                  return spaceIdx > 0 ? line.slice(spaceIdx + 1) : line;
                }),
            ),
            Effect.catch(() => Effect.succeed([] as readonly string[])),
          ),
      } satisfies GitStagingService;
    }),
  );
}

/** Run a git command in the given repo directory and return stdout */
const runGit = Effect.fn("GitStaging.runGit")(function* (
  repoPath: string,
  args: readonly string[],
) {
  return yield* gitOutput(args, { cwd: repoPath }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => log(`Error: ${error.message}`)),
    ),
    Effect.mapError((error) => new GitStagingError({ message: error.message })),
  );
});

/** Run a git command that produces no meaningful output */
function runGitVoid(
  repoPath: string,
  args: readonly string[],
): Effect.Effect<void, GitStagingError, CommandExecutor> {
  return gitRequired(args, { cwd: repoPath }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => log(`Error: ${error.message}`)),
    ),
    Effect.mapError((error) => new GitStagingError({ message: error.message })),
  );
}

/**
 * Parse a single line of `git status --porcelain` output.
 *
 * Format: `XY <path>` where X is index status, Y is worktree status.
 * Returns up to two StagedFile entries (one staged, one unstaged) per line.
 */
function parseStatusLine(line: string): readonly StagedFile[] {
  if (line.length < 4) return [];

  const x = line[0]; // index status
  const y = line[1]; // worktree status
  const path = line.slice(3);
  const results: StagedFile[] = [];

  // X column: staged changes (anything except ' ', '?' and '!')
  if (x !== " " && x !== "?" && x !== "!") {
    results.push({ path, status: x as GitStatusCode, staged: true });
  }

  // Y column: unstaged changes
  if (y !== " " && y !== "?" && y !== "!") {
    results.push({ path, status: y as GitStatusCode, staged: false });
  }

  // Untracked files: ?? means untracked (show as unstaged)
  if (x === "?" && y === "?") {
    results.push({ path, status: "?", staged: false });
  }

  // Ignored files: !! (skip them)

  return results;
}
