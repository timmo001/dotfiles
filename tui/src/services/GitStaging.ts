import { Context, Effect, Layer } from "effect";
import type { GitStatusCode, StagedFile } from "../types.js";

const log = (msg: string) => console.error(`[dot-tui:GitStaging] ${msg}`);

/** Service interface for git staging operations scoped to a single repository */
export interface GitStagingService {
  /** Parse `git status --porcelain` output into staged and unstaged file lists */
  readonly getStatus: (
    repoPath: string,
  ) => Effect.Effect<readonly StagedFile[], Error>;
  /** Stage a single file via `git add` */
  readonly stageFile: (
    repoPath: string,
    file: string,
  ) => Effect.Effect<void, Error>;
  /** Unstage a single file via `git reset HEAD` */
  readonly unstageFile: (
    repoPath: string,
    file: string,
  ) => Effect.Effect<void, Error>;
  /** Stage all files via `git add -A` */
  readonly stageAll: (repoPath: string) => Effect.Effect<void, Error>;
  /** Commit staged changes with the given message */
  readonly commit: (
    repoPath: string,
    message: string,
  ) => Effect.Effect<void, Error>;
  /** Get recent commit messages from a repository */
  readonly getRecentCommits: (
    repoPath: string,
    count: number,
  ) => Effect.Effect<readonly string[], Error>;
}

/** Effect service tag for {@link GitStagingService} */
export class GitStaging extends Context.Tag("GitStaging")<
  GitStaging,
  GitStagingService
>() {}

/** Run a git command in the given repo directory and return stdout */
function runGit(
  repoPath: string,
  args: readonly string[],
): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    try: async () => {
      const cmd = ["git", "-C", repoPath, ...args];
      log(`Running: ${cmd.join(" ")}`);
      const proc = Bun.spawn(cmd, {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(
          `git ${args[0]} failed (exit ${exitCode}): ${stderr.trim()}`,
        );
      }

      return stdout;
    },
    catch: (error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      log(`Error: ${err.message}`);
      return err;
    },
  });
}

/** Run a git command that produces no meaningful output */
function runGitVoid(
  repoPath: string,
  args: readonly string[],
): Effect.Effect<void, Error> {
  return runGit(repoPath, args).pipe(Effect.asVoid);
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

/** Live layer providing git staging operations via CLI */
export const GitStagingLive = Layer.succeed(GitStaging, {
  getStatus: (repoPath) =>
    runGit(repoPath, ["status", "--porcelain"]).pipe(
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
    return runGitVoid(repoPath, ["add", "--", file]);
  },

  unstageFile: (repoPath, file) => {
    log(`Unstaging: ${file}`);
    return runGitVoid(repoPath, ["reset", "HEAD", "--", file]);
  },

  stageAll: (repoPath) => {
    log(`Staging all in ${repoPath}`);
    return runGitVoid(repoPath, ["add", "-A"]);
  },

  commit: (repoPath, message) => {
    log(`Committing in ${repoPath}: ${message}`);
    return runGitVoid(repoPath, ["commit", "-m", message]);
  },

  getRecentCommits: (repoPath, count) =>
    runGit(repoPath, ["log", "--oneline", `-${count}`]).pipe(
      Effect.map((stdout) =>
        stdout
          .trim()
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => {
            // Strip the short hash prefix: "abc1234 Fix something" -> "Fix something"
            const spaceIdx = line.indexOf(" ");
            return spaceIdx > 0 ? line.slice(spaceIdx + 1) : line;
          }),
      ),
      Effect.catchAll(() => Effect.succeed([] as readonly string[])),
    ),
});
