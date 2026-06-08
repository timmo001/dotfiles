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
