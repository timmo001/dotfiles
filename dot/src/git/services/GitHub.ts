import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import {
  CommandExecutor,
  type CommandError,
} from "../../services/CommandExecutor.js";
import { ENV, envNonNegativeInt, envString } from "../../lib/env.js";

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
class GitHubError extends Schema.TaggedErrorClass<GitHubError>()(
  "GitHubError",
  {
    command: Schema.String,
    exitCode: Schema.Number,
    stderr: Schema.String,
    retryable: Schema.Boolean,
    rateLimited: Schema.Boolean,
  },
) {}

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

interface RateLimitSnapshot {
  readonly remaining: number;
  readonly resetEpochSeconds: number;
  readonly checkedAtMillis: number;
}

type GitHubAttemptResult =
  | { readonly type: "success"; readonly output: string }
  | { readonly type: "failure"; readonly error: GitHubError };

/** Effect service for {@link GitHubService}. */
export class GitHub extends Context.Service<GitHub, GitHubService>()("GitHub") {
  static readonly layer = Layer.effect(
    GitHub,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      let rateLimitCache: RateLimitSnapshot | null = null;

      const isAvailable = () =>
        executor
          .exitCode("which", ["gh"])
          .pipe(Effect.map((code) => code === 0));

      const fetchRateLimit = Effect.fn("GitHub.fetchRateLimit")(function* (
        checkedAtMillis: number,
      ) {
        const raw = yield* executor.run("gh", [
          "api",
          "rate_limit",
          "--jq",
          ".resources.core | [.remaining, .reset] | @tsv",
        ]);
        return parseRateLimit(raw, checkedAtMillis);
      });

      const getRateLimit = Effect.fn("GitHub.getRateLimit")(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (
          rateLimitCache &&
          now - rateLimitCache.checkedAtMillis < RATE_LIMIT_TTL_MS
        ) {
          return rateLimitCache;
        }

        const snapshot = yield* fetchRateLimit(now).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        rateLimitCache = snapshot;
        return snapshot;
      });

      const ensureRateLimit = Effect.fn("GitHub.ensureRateLimit")(function* (
        args: readonly string[],
      ) {
        if (isRateLimitCommand(args)) return;

        const snapshot = yield* getRateLimit();
        if (!snapshot) return;

        return yield* guardRateLimit(args, snapshot);
      });

      const guardRateLimit = Effect.fn("GitHub.guardRateLimit")(function* (
        args: readonly string[],
        snapshot: RateLimitSnapshot,
      ): Effect.fn.Return<void, GitHubError> {
        if (hasRateLimitCapacity(snapshot)) return;

        const now = yield* Clock.currentTimeMillis;
        const resetInSeconds = Math.max(
          0,
          snapshot.resetEpochSeconds - Math.floor(now / 1000),
        );

        if (resetInSeconds <= RATE_LIMIT_MAX_WAIT_SECONDS) {
          yield* Effect.sleep(Duration.seconds(resetInSeconds + 1));
          rateLimitCache = null;
          return;
        }

        return yield* new GitHubError({
          command: formatGhCommand(args),
          exitCode: 1,
          stderr: `GitHub REST API rate limit exhausted; resets at ${new Date(snapshot.resetEpochSeconds * 1000).toISOString()}`,
          retryable: false,
          rateLimited: true,
        });
      });

      const runAttempt = (args: readonly string[]) =>
        executor.run("gh", args).pipe(
          Effect.matchEffect({
            onSuccess: (output) =>
              Effect.succeed({ type: "success" as const, output }),
            onFailure: (error) =>
              Effect.succeed({
                type: "failure" as const,
                error: toGitHubError(args, error),
              }),
          }),
        );

      const runWithRetry = Effect.fn("GitHub.runWithRetry")(function* (
        args: readonly string[],
        retries: number,
        attempt: number,
        checkRateLimit: boolean,
      ): Effect.fn.Return<string, GitHubError> {
        if (checkRateLimit) yield* ensureRateLimit(args);

        const result: GitHubAttemptResult = yield* runAttempt(args);
        if (result.type === "success") return result.output;

        const { error } = result;
        clearRateLimitCache(error);
        if (!shouldRetry(error, attempt, retries)) {
          return yield* error;
        }

        const delaySeconds = retryDelaySeconds(attempt);
        log(
          `Retrying ${formatGhCommand(args)} after ${delaySeconds}s (${attempt + 1}/${retries})`,
        );
        yield* Effect.sleep(Duration.seconds(delaySeconds));
        return yield* runWithRetry(args, retries, attempt + 1, checkRateLimit);
      });

      function clearRateLimitCache(error: GitHubError): void {
        if (error.rateLimited) rateLimitCache = null;
      }

      const run = Effect.fn("GitHub.run")(function* (
        args: readonly string[],
        opts?: GitHubCommandOptions,
      ): Effect.fn.Return<string, GitHubError> {
        const retries = opts?.retries ?? DEFAULT_RETRIES;
        return yield* runWithRetry(
          args,
          retries,
          0,
          opts?.checkRateLimit !== false,
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
              try: () => JSON.parse(output) as unknown,
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

function parseRateLimit(
  raw: string,
  checkedAtMillis: number,
): RateLimitSnapshot | null {
  const [remainingRaw, resetRaw] = raw.trim().split(/\s+/, 2);
  return parseRateLimitFields(remainingRaw, resetRaw, checkedAtMillis);
}

function parseRateLimitFields(
  remainingRaw: string | undefined,
  resetRaw: string | undefined,
  checkedAtMillis: number,
): RateLimitSnapshot | null {
  const remaining = parseInteger(remainingRaw);
  const resetEpochSeconds = parseInteger(resetRaw);

  if (remaining === null || resetEpochSeconds === null) return null;

  return { remaining, resetEpochSeconds, checkedAtMillis };
}

function parseInteger(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasRateLimitCapacity(snapshot: RateLimitSnapshot): boolean {
  return snapshot.remaining > RATE_LIMIT_MIN_REMAINING;
}

function shouldRetry(
  error: GitHubError,
  attempt: number,
  retries: number,
): boolean {
  return attempt < retries && error.retryable;
}

function toGitHubError(
  args: readonly string[],
  error: CommandError,
): GitHubError {
  const rateLimited = isRateLimitMessage(error.stderr);
  return new GitHubError({
    command: formatGhCommand(args),
    exitCode: error.exitCode,
    stderr: error.stderr,
    retryable: rateLimited || isTransientMessage(error.stderr),
    rateLimited,
  });
}

function isRateLimitCommand(args: readonly string[]): boolean {
  return args[0] === "api" && args[1] === "rate_limit";
}

function isRateLimitMessage(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return lower.includes("rate limit") || lower.includes("secondary rate");
}

function isTransientMessage(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

const TRANSIENT_ERROR_PATTERNS = [
  "http 5",
  "502",
  "503",
  "504",
  "connection reset",
  "could not resolve host",
  "network is unreachable",
  "temporarily unavailable",
  "timeout",
  "tls handshake",
] as const;

function retryDelaySeconds(attempt: number): number {
  return 2 ** attempt;
}

function formatGhCommand(args: readonly string[]): string {
  return `gh ${args.join(" ")}`;
}
