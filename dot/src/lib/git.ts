import { Gh } from "@timmo001/effect-gh";
import { Duration, Effect, FileSystem, Schedule, Schema } from "effect";
import { dirname, join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Launcher } from "../services/Launcher.js";
import { OutputLog } from "../services/OutputLog.js";
import { displayPath } from "./paths.js";
import { ghOutput } from "./gh.js";
import { pathExists } from "./fsProbe.js";
import { spawnCaptured } from "./spawnText.js";
import type { CommandError } from "../services/CommandExecutor.js";

/** Options for git commands that run inside a repository. */
export interface GitCommandOptions {
  /** Working directory for the command. */
  readonly cwd?: string;
}

/** Domain error for shared git and GitHub CLI command failures. */
class GitCommandError extends Schema.TaggedError<GitCommandError>()(
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
export const isGitRepo = Effect.fn("Git.isGitRepo")(function* (
  repoPath: string,
) {
  return yield* pathExists(join(repoPath, ".git"));
});

/** Run a git command and return trimmed stdout, or an empty string on any failure. */
const gitOrEmpty = Effect.fn("Git.gitOrEmpty")(function* (
  repoPath: string,
  args: readonly string[],
) {
  const result = yield* spawnCaptured("git", args, { cwd: repoPath }).pipe(
    Effect.orElseSucceed(() => null),
  );

  if (result === null || result.exitCode !== 0) return "";

  return result.stdout.trim();
});

/** Return the current branch name, or an empty string when unavailable. */
export const gitCurrentBranch = Effect.fn("Git.currentBranch")(function* (
  repoPath: string,
) {
  return yield* gitOrEmpty(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
});

/** Return the `origin` remote URL, or an empty string when unavailable. */
export const gitRemoteOrigin = Effect.fn("Git.remoteOrigin")(function* (
  repoPath: string,
) {
  return yield* gitOrEmpty(repoPath, ["remote", "get-url", "origin"]);
});

/** Run `git <args>` and return stdout. */
export function gitOutput(
  args: readonly string[],
  opts?: GitCommandOptions & {
    /** Extra environment variables for the command. */
    readonly env?: Readonly<Record<string, string>>;
  },
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

/** Default hard timeout for a networked git command (ls-remote, fetch, set-head). */
export const GIT_REMOTE_TIMEOUT = Duration.seconds(10);

/**
 * Connection failures worth another attempt. Timeouts are excluded: each
 * attempt is already bounded, and callers own any retry after a timeout.
 * Access and missing-repository errors are not transient.
 */
const TRANSIENT_REMOTE_ERROR =
  /connection (reset|closed|refused|timed out)|kex_exchange_identification|ssh_exchange_identification|broken pipe|could not resolve host|temporary failure in name resolution|network is unreachable|the remote end hung up unexpectedly/i;

/** Whether a remote git failure is a transient connection problem. */
export function isTransientRemoteError(message: string): boolean {
  return TRANSIENT_REMOTE_ERROR.test(message);
}

/** Retry options accepted by `Effect.retry` for remote operations. */
export interface TransientRemoteRetry<E> {
  readonly schedule: Schedule.Schedule<Duration.Duration>;
  readonly times: number;
  readonly while: (error: E) => boolean;
}

/**
 * Shared retry policy for remote operations: two retries with exponential
 * backoff from 500ms, only after a transient connection failure or a failure
 * matching the caller's `extra` pattern.
 */
export function transientRemoteRetry<E>(
  message: (error: E) => string,
  extra?: RegExp,
): TransientRemoteRetry<E> {
  return {
    schedule: Schedule.exponential("500 millis"),
    times: 2,
    while: (error: E) =>
      isTransientRemoteError(message(error)) ||
      (extra?.test(message(error)) ?? false),
  };
}

/** Whether a {@link gitRemoteOutput} failure came from its timeout. */
export function isRemoteTimeout(message: string): boolean {
  return / timed out after \d+s$/.test(message);
}

/**
 * Run a networked `git <args>` and return trimmed stdout, bounded by a timeout.
 *
 * Credential prompts are disabled with `GIT_TERMINAL_PROMPT=0` and SSH runs in
 * batch mode, so a private or unreachable remote fails instead of prompting.
 * Each attempt has a hard timeout that kills the spawned process (see
 * `killOnAbort` in CommandExecutor). Transient connection failures are retried
 * twice with exponential backoff (see {@link isTransientRemoteError}).
 */
export function gitRemoteOutput(
  args: readonly string[],
  opts?: GitCommandOptions,
  timeout: Duration.Duration = GIT_REMOTE_TIMEOUT,
): Effect.Effect<string, GitCommandError, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    const attempt = executor
      .run(
        "env",
        [
          "GIT_TERMINAL_PROMPT=0",
          "GIT_SSH_COMMAND=ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
          "git",
          ...args,
        ],
        opts,
      )
      .pipe(
        Effect.map((output) => output.trim()),
        Effect.catchTag("CommandError", (error) =>
          fail(commandFailureMessage("git", args, error)),
        ),
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            fail(
              `${commandText("git", args)} timed out after ${Duration.toSeconds(timeout)}s`,
            ),
        }),
      );

    return yield* attempt.pipe(
      Effect.retry(
        transientRemoteRetry<{ readonly message: string }>(
          (error) => error.message,
        ),
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

/** Run `git <args>` with inherited stdio and return the exit code without failing. */
export function gitInheritExitCode(
  args: readonly string[],
  opts?: GitCommandOptions,
): Effect.Effect<number, never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    return yield* executor.inherit("git", args, opts);
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

/** Create the parent directory of a clone target. */
const ensureParentDirectory = Effect.fn("Git.ensureParentDirectory")(function* (
  repoPath: string,
) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs
    .makeDirectory(dirname(repoPath), { recursive: true })
    .pipe(Effect.catch((error) => fail(error.message)));
});

/** Clone a GitHub repository using `gh repo clone`, respecting gh's configured protocol. */
export function ghRepoClone(
  remote: string,
  repoPath: string,
): Effect.Effect<
  void,
  GitCommandError,
  CommandExecutor | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    yield* ensureParentDirectory(repoPath);
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
 * Unlike {@link ghRepoClone} this captures the SDK stream, so clone
 * progress never reaches the terminal. Use it on flows that pin a spinner
 * (e.g. `dot init`), where inherited git/gh output would clash with the
 * animated line. Captured stdio cannot answer interactive prompts, so reserve
 * it for public repositories or callers that already hold `gh` auth.
 */
export function ghRepoCloneCaptured(
  remote: string,
  repoPath: string,
  gitArgs: readonly string[] = [],
): Effect.Effect<void, GitCommandError, Gh | FileSystem.FileSystem> {
  return Effect.gen(function* () {
    yield* ensureParentDirectory(repoPath);
    const gh = yield* Gh;

    const args = [
      "repo",
      "clone",
      remote,
      repoPath,
      ...(gitArgs.length > 0 ? ["--", ...gitArgs] : []),
    ];

    yield* ghOutput(gh, args, {
      env: {
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND:
          "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
      },
    }).pipe(
      Effect.catchTag("CommandError", (error) =>
        fail(commandFailureMessage("gh", args, error)),
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
 * Bound the background `git remote set-head --auto` refresh. Each call queries
 * the remote over the network, so a single slow or unreachable remote would
 * otherwise keep the forked refresh (and the pull scope that awaits it) alive
 * indefinitely. On timeout the process is killed and the refresh is skipped.
 */
const REFRESH_REMOTE_HEAD_TIMEOUT = Duration.seconds(15);

/**
 * Refresh a repository's local `<remote>/HEAD` symbolic-ref so it tracks the
 * remote's current default branch. Clones capture `<remote>/HEAD` once and never
 * auto-update it, so a default-branch rename on the remote leaves the local ref
 * stale and misleads tooling that derives the default branch from it (e.g.
 * `context git`).
 *
 * Queries the remote (`git remote set-head <remote> --auto`) and is non-fatal:
 * a missing remote, offline state, timeout, or any other failure resolves to
 * no-op so callers in the update/pull flow never break on it. Runs through
 * {@link gitRemoteOutput}, so it is prompt-free, time-bounded and retried.
 */
export function gitRefreshRemoteHead(
  repoPath: string,
  remote = "origin",
): Effect.Effect<void, never, CommandExecutor> {
  return gitRemoteOutput(
    ["remote", "set-head", remote, "--auto"],
    { cwd: repoPath },
    REFRESH_REMOTE_HEAD_TIMEOUT,
  ).pipe(Effect.ignore);
}

/** Per-attempt bound on the network fetch that starts a pull. */
const PULL_FETCH_TIMEOUT = Duration.seconds(20);

/**
 * Fast-forward a repository without stashing or rebasing local work. Returns
 * true only when the pull succeeds. The network fetch runs first through
 * {@link gitRemoteOutput}, so it is prompt-free and retried after transient
 * connection failures; the fast-forward and submodule checkout then run
 * locally. Timeout and retry of the whole pull are owned by the caller
 * (see `safePull` in the update flow), which holds the
 * per-repo context needed to report and retry.
 */
export function gitPullFastForward(
  repoPath: string,
): Effect.Effect<boolean, never, CommandExecutor | Launcher | OutputLog> {
  return Effect.gen(function* () {
    const launcher = yield* Launcher;
    const log = yield* OutputLog;

    // Pull updates submodules after moving the parent HEAD, so refuse active
    // submodule work first rather than leaving a partially applied pull. A
    // clean checkout away from its pin is only local work when it holds
    // commits no remote has; otherwise it is a stale pin that update restores.
    const submodulesClean = yield* launcher
      .stream(
        `git submodule foreach --recursive 'if test -n "$(git status --porcelain --untracked-files=normal --ignore-submodules=none)" || { test "$(git rev-parse HEAD)" != "$sha1" && test -n "$(git rev-list -n 1 HEAD --not --remotes)"; }; then echo "Local work in submodule $displaypath; skipping pull" >&2; exit 1; fi'`,
        { cwd: repoPath },
      )
      .pipe(Effect.orElseSucceed(() => 1));

    if (submodulesClean !== 0) return false;

    const fetchError = yield* gitRemoteOutput(
      ["fetch", "--quiet", "--recurse-submodules=yes", "--jobs=8"],
      { cwd: repoPath },
      PULL_FETCH_TIMEOUT,
    ).pipe(
      Effect.as(null),
      Effect.catch((error) => Effect.succeed(error.message)),
    );

    if (fetchError) {
      yield* log.warn(fetchError);

      return false;
    }

    const exitCode = yield* launcher
      .stream(
        "git merge --ff-only --no-autostash --no-edit '@{u}' && git submodule sync --recursive && GIT_TERMINAL_PROMPT=0 git submodule update --init --recursive --checkout --jobs=8",
        { cwd: repoPath },
      )
      .pipe(Effect.orElseSucceed(() => 1));

    return exitCode === 0;
  });
}
