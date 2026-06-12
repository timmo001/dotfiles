import { Effect, Schema } from "effect";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Launcher } from "../services/Launcher.js";
import { displayPath } from "./paths.js";
import type { CommandError } from "../services/CommandExecutor.js";

/** Options for git commands that run inside a repository. */
export interface GitCommandOptions {
  /** Working directory for the command. */
  readonly cwd?: string;
}

/** Domain error for shared git and GitHub CLI command failures. */
class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()(
  "GitCommandError",
  {
    message: Schema.String,
  },
) {}

/** Render a command and args for readable logs and failures. */
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

function fail(message: string): Effect.Effect<never, GitCommandError> {
  return Effect.fail(new GitCommandError({ message }));
}

/** Check whether a path is a checked-out git repository. */
export function isGitRepo(repoPath: string): boolean {
  return existsSync(join(repoPath, ".git"));
}

/** Return the current branch name synchronously, or an empty string when unavailable. */
export function gitCurrentBranchSync(repoPath: string): string {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return "";
    return new TextDecoder().decode(result.stdout).trim();
  } catch {
    return "";
  }
}

/** Return the `origin` remote URL synchronously, or an empty string when unavailable. */
export function gitRemoteOriginSync(repoPath: string): string {
  try {
    const result = Bun.spawnSync(["git", "remote", "get-url", "origin"], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return "";
    return new TextDecoder().decode(result.stdout).trim();
  } catch {
    return "";
  }
}

/** Run `git <args>` and return stdout. */
export function gitOutput(
  args: readonly string[],
  opts?: GitCommandOptions,
): Effect.Effect<string, GitCommandError, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    return yield* executor
      .run("git", args, opts)
      .pipe(
        Effect.catchTag("CommandError", (error) =>
          fail(commandFailureMessage("git", args, error)),
        ),
      );
  });
}

/** Run `git <args>` and return the exit code without failing on non-zero. */
export function gitExitCode(
  args: readonly string[],
  opts?: GitCommandOptions,
): Effect.Effect<number, never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    return yield* executor.exitCode("git", args, opts);
  });
}

/** Run `git <args>` with inherited stdio and fail on non-zero exit. */
export function gitRequired(
  args: readonly string[],
  opts?: GitCommandOptions,
): Effect.Effect<void, GitCommandError, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const exitCode = yield* executor.inherit("git", args, opts);
    if (exitCode !== 0) {
      return yield* fail(`${commandText("git", args)} exited ${exitCode}`);
    }
  });
}

/** Clone a GitHub repository using `gh repo clone`, respecting gh's configured protocol. */
export function ghRepoClone(
  remote: string,
  repoPath: string,
): Effect.Effect<void, GitCommandError, CommandExecutor> {
  return Effect.gen(function* () {
    mkdirSync(dirname(repoPath), { recursive: true });
    const executor = yield* CommandExecutor;
    const exitCode = yield* executor.inherit("gh", [
      "repo",
      "clone",
      remote,
      repoPath,
    ]);
    if (exitCode !== 0) {
      return yield* fail(
        `gh repo clone ${remote} ${displayPath(repoPath)} exited ${exitCode}`,
      );
    }
  });
}

/**
 * Clone a GitHub repository with captured stdio, returning only on success.
 *
 * Unlike {@link ghRepoClone} this runs through `executor.run`, so clone
 * progress never reaches the terminal. Use it on flows that pin a spinner
 * (e.g. `dot init`), where inherited git/gh output would clash with the
 * animated line. Captured stdio cannot answer interactive prompts, so reserve
 * it for public repositories or callers that already hold `gh` auth.
 */
export function ghRepoCloneCaptured(
  remote: string,
  repoPath: string,
): Effect.Effect<void, GitCommandError, CommandExecutor> {
  return Effect.gen(function* () {
    mkdirSync(dirname(repoPath), { recursive: true });
    const executor = yield* CommandExecutor;
    yield* executor
      .run("gh", ["repo", "clone", remote, repoPath])
      .pipe(
        Effect.catchTag("CommandError", (error) =>
          fail(
            commandFailureMessage(
              "gh",
              ["repo", "clone", remote, repoPath],
              error,
            ),
          ),
        ),
      );
  });
}

/** Return true when `repoPath` has no porcelain status entries. */
export function gitWorkingTreeClean(
  repoPath: string,
): Effect.Effect<boolean, GitCommandError, CommandExecutor> {
  return Effect.gen(function* () {
    const status = (yield* gitOutput(["status", "--porcelain"], {
      cwd: repoPath,
    })).trim();
    return status.length === 0;
  });
}

/** Return the current HEAD commit hash for a repository. */
export function gitHead(
  repoPath: string,
): Effect.Effect<string, GitCommandError, CommandExecutor> {
  return gitOutput(["rev-parse", "HEAD"], { cwd: repoPath }).pipe(
    Effect.map((head) => head.trim()),
  );
}

/**
 * Refresh a repository's local `<remote>/HEAD` symbolic-ref so it tracks the
 * remote's current default branch. Clones capture `<remote>/HEAD` once and never
 * auto-update it, so a default-branch rename on the remote leaves the local ref
 * stale and misleads tooling that derives the default branch from it (e.g.
 * `dot git-status`, `dot git-log`, the branch-context plugin).
 *
 * Queries the remote (`git remote set-head <remote> --auto`) and is non-fatal:
 * a missing remote, offline state, or any other failure resolves to no-op so
 * callers in the update/pull flow never break on it.
 */
export function gitRefreshRemoteHead(
  repoPath: string,
  remote = "origin",
): Effect.Effect<void, never, CommandExecutor> {
  return gitExitCode(["remote", "set-head", remote, "--auto"], {
    cwd: repoPath,
  }).pipe(Effect.asVoid);
}

/** Pull a repository with rebase, streaming output through the launcher. */
export function gitPullRebase(
  repoPath: string,
): Effect.Effect<boolean, never, CommandExecutor | Launcher> {
  return Effect.gen(function* () {
    const launcher = yield* Launcher;
    const exitCode = yield* launcher
      .stream("git pull --rebase --no-edit", {
        cwd: repoPath,
      })
      .pipe(Effect.catch(() => Effect.succeed(1)));

    if (exitCode === 0) return true;

    yield* gitExitCode(["rebase", "--abort"], { cwd: repoPath }).pipe(
      Effect.catch(() => Effect.succeed(1)),
    );
    return false;
  });
}
