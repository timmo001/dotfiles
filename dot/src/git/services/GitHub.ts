import {
  Gh,
  GhCommandError,
  RateLimit,
  isRateLimited,
  isTransient,
} from "@timmo001/effect-gh";
import {
  Cache,
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Schedule,
  Schema,
} from "effect";
import {
  CommandExecutor,
  type CommandError,
} from "../../services/CommandExecutor.js";
import { ENV, envNonNegativeInt, envString } from "../../lib/env.js";
import { ghOutput } from "../../lib/gh.js";

const DEBUG = !!envString(ENV.DOT_DEBUG);

const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:GitHub] ${msg}`);
};

const DEFAULT_RETRIES = envNonNegativeInt(ENV.DOT_GITHUB_RETRIES, 2);

const RATE_LIMIT_TTL_MS =
  envNonNegativeInt(ENV.DOT_GITHUB_RATE_LIMIT_TTL_SECONDS, 60) * 1000;

const RATE_LIMIT_MIN_REMAINING = envNonNegativeInt(
  ENV.DOT_GITHUB_RATE_LIMIT_MIN_REMAINING,
  0,
);

const RATE_LIMIT_MAX_WAIT_SECONDS = envNonNegativeInt(
  ENV.DOT_GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS,
  60,
);

/** Domain error for GitHub CLI/API operations. */
class GitHubError extends Schema.TaggedError<GitHubError>()("GitHubError", {
  command: Schema.String,
  exitCode: Schema.Number,
  stderr: Schema.String,
  retryable: Schema.Boolean,
  rateLimited: Schema.Boolean,
}) {}

/** Options for GitHub CLI commands. */
interface GitHubCommandOptions {
  /** Number of retries after the initial attempt. Defaults to `DOT_GITHUB_RETRIES` or 2. */
  readonly retries?: number;
  /** Whether to check REST API rate-limit state before the command. Defaults to true. */
  readonly checkRateLimit?: boolean;
}

/** Options for `gh api` calls. */
interface GitHubApiOptions extends GitHubCommandOptions {
  /** Optional `--jq` filter applied by `gh api`. */
  readonly jq?: string;
}

/** Service interface for all GitHub CLI/API communication. */
export interface GitHubService {
  /** Return whether the GitHub CLI is available on PATH. */
  readonly isAvailable: () => Effect.Effect<boolean>;
  /** Run a raw `gh` command with rate-limit checks and retries. */
  readonly run: (
    args: readonly string[],
    opts?: GitHubCommandOptions,
  ) => Effect.Effect<string, GitHubError>;
  /** Run `gh api` with rate-limit checks, retries, and optional `--jq`. */
  readonly api: (
    endpoint: string,
    opts?: GitHubApiOptions,
  ) => Effect.Effect<string, GitHubError>;
  /** Run a `gh` command expected to return JSON and parse the response. */
  readonly json: (
    args: readonly string[],
    opts?: GitHubCommandOptions,
  ) => Effect.Effect<unknown, GitHubError>;
}

/** Effect service for {@link GitHubService}. */
export class GitHub extends Context.Service<GitHub, GitHubService>()("GitHub") {
  static readonly layer = Layer.effect(
    GitHub,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      const gh = yield* Gh;

      const rateLimits = yield* RateLimit.cached(
        Duration.millis(RATE_LIMIT_TTL_MS),
      ).pipe(Effect.provideService(Gh, gh));

      const isAvailable = () =>
        executor
          .exitCode("which", ["gh"])
          .pipe(Effect.map((code) => code === 0));

      const ensureRateLimit = Effect.fn("GitHub.ensureRateLimit")(function* (
        args: readonly string[],
      ): Effect.fn.Return<void, GitHubError> {
        if (isRateLimitCommand(args)) return;

        const snapshot = yield* Cache.get(rateLimits, "core").pipe(
          Effect.option,
        );

        if (Option.isNone(snapshot)) return;

        if (snapshot.value.remaining > RATE_LIMIT_MIN_REMAINING) return;

        const now = yield* Clock.currentTimeMillis;
        const resetEpochSeconds = snapshot.value.reset;

        const resetInSeconds = Math.max(
          0,
          resetEpochSeconds - Math.floor(now / 1000),
        );

        if (resetInSeconds <= RATE_LIMIT_MAX_WAIT_SECONDS) {
          yield* Effect.sleep(Duration.seconds(resetInSeconds + 1));
          yield* Cache.invalidate(rateLimits, "core");

          return;
        }

        return yield* new GitHubError({
          command: formatGhCommand(args),
          exitCode: 1,
          stderr: `GitHub REST API rate limit exhausted; resets at ${new Date(resetEpochSeconds * 1000).toISOString()}`,
          retryable: false,
          rateLimited: true,
        });
      });

      const run = Effect.fn("GitHub.run")(function* (
        args: readonly string[],
        opts?: GitHubCommandOptions,
      ): Effect.fn.Return<string, GitHubError> {
        const retries = opts?.retries ?? DEFAULT_RETRIES;

        const attempt = ghOutput(gh, args).pipe(
          Effect.mapError((error) => toGitHubError(args, error)),
          Effect.tapError((error) =>
            error.rateLimited
              ? Cache.invalidate(rateLimits, "core")
              : Effect.void,
          ),
        );

        return yield* (
          opts?.checkRateLimit === false
            ? attempt
            : ensureRateLimit(args).pipe(Effect.andThen(attempt))
        ).pipe(
          Effect.retry({
            times: retries,
            schedule: Schedule.exponential("1 second").pipe(
              Schedule.tap(({ duration }) =>
                Effect.sync(() =>
                  log(
                    `Retrying ${formatGhCommand(args)} after ${Duration.toMillis(duration) / 1000}s`,
                  ),
                ),
              ),
            ),
            while: (error) => error.retryable,
          }),
        );
      });

      const api = (endpoint: string, opts?: GitHubApiOptions) => {
        const args = ["api", endpoint];

        if (opts?.jq) args.push("--jq", opts.jq);

        return run(args, opts).pipe(Effect.map((output) => output.trim()));
      };

      const json = (args: readonly string[], opts?: GitHubCommandOptions) =>
        run(args, opts).pipe(
          Effect.flatMap((output) =>
            Effect.try({
              try: () => JSON.parse(output),
              catch: (error) =>
                new GitHubError({
                  command: formatGhCommand(args),
                  exitCode: 1,
                  stderr:
                    error instanceof Error ? error.message : String(error),
                  retryable: false,
                  rateLimited: false,
                }),
            }),
          ),
        );

      return { isAvailable, run, api, json };
    }),
  );
}

function toGitHubError(
  args: readonly string[],
  error: CommandError,
): GitHubError {
  const classified = new GhCommandError({
    executable: "gh",
    exitCode: error.exitCode,
    stdout: "",
    stdoutTruncated: false,
    stderr: error.stderr,
    stderrTruncated: false,
  });

  return new GitHubError({
    command: formatGhCommand(args),
    exitCode: error.exitCode,
    stderr: error.stderr,
    retryable: isTransient(classified),
    rateLimited: isRateLimited(classified),
  });
}

function isRateLimitCommand(args: readonly string[]): boolean {
  return args[0] === "api" && args[1] === "rate_limit";
}

function formatGhCommand(args: readonly string[]): string {
  return `gh ${args.join(" ")}`;
}
