import {
  Api,
  Gh,
  RateLimit,
  isRateLimited,
  isTransient,
  type GhError,
} from "@timmo001/effect-gh";
import {
  Cache,
  Clock,
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Match,
  Schedule,
  Schema,
} from "effect";
import { NodeServices } from "@effect/platform-node";
import { join } from "node:path";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { writeFileAtomic } from "../../lib/atomicWrite.js";
import { ENV, envNonNegativeInt, envString } from "../../lib/env.js";
import { CACHE_DIR } from "../../lib/paths.js";
import { formatCause } from "../../lib/schema.js";

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

const RATE_LIMIT_FILE = join(CACHE_DIR, "dot", "github-rate-limit.json");

const SharedRateLimit = Schema.fromJsonString(
  Schema.Struct({ reset: Schema.Finite }),
);

// Exhaustion is shared through a file, so other dot processes stop calling
// GitHub until the reset instead of each one finding out on its own.
const readExhaustedUntil = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(file);

    return (yield* Schema.decodeEffect(SharedRateLimit)(text)).reset;
  }).pipe(
    Effect.orElseSucceed(() => 0),
    Effect.provide(NodeServices.layer),
  );

const writeExhaustedUntil = (file: string, reset: number) =>
  Effect.try(() =>
    writeFileAtomic(file, JSON.stringify({ reset }), {
      mode: 0o600,
      createDirectory: true,
    }),
  ).pipe(Effect.ignore);

const exhaustedError = (label: string, reset: number) =>
  new GitHubError({
    command: label,
    exitCode: 1,
    stderr: `GitHub REST API rate limit exhausted; resets at ${new Date(reset * 1000).toISOString()}`,
    retryable: false,
    rateLimited: true,
  });

/** Domain error for GitHub CLI/API operations. */
export class GitHubError extends Schema.TaggedError<GitHubError>()(
  "GitHubError",
  {
    command: Schema.String,
    exitCode: Schema.Finite,
    stderr: Schema.String,
    retryable: Schema.Boolean,
    rateLimited: Schema.Boolean,
  },
) {}

/** Options for GitHub operations. */
export interface GitHubCommandOptions {
  /** Number of retries after the initial attempt. Defaults to `DOT_GITHUB_RETRIES` or 2. */
  readonly retries?: number;
  /** Whether to check REST API rate-limit state before the operation. Defaults to true. */
  readonly checkRateLimit?: boolean;
}

/** Service interface for all GitHub communication, wrapping typed effect-gh operations. */
export interface GitHubService {
  /** Return whether the GitHub CLI is available on PATH. */
  readonly isAvailable: Effect.Effect<boolean>;
  /**
   * Run an idempotent effect-gh read with a rate-limit check and bounded
   * retries of transient failures. `label` names the operation in errors.
   */
  readonly read: <A, R>(
    label: string,
    operation: Effect.Effect<A, GhError, R>,
    opts?: GitHubCommandOptions,
  ) => Effect.Effect<A, GitHubError, Exclude<R, Gh>>;
  /** Run an effect-gh mutation with a rate-limit check and no retries. */
  readonly write: <A, R>(
    label: string,
    operation: Effect.Effect<A, GhError, R>,
    opts?: Omit<GitHubCommandOptions, "retries">,
  ) => Effect.Effect<A, GitHubError, Exclude<R, Gh>>;
}

/** Effect service for {@link GitHubService}. */
export class GitHub extends Context.Service<GitHub, GitHubService>()("GitHub") {
  /**
   * Build the service. `rateLimitFile` shares rate-limit exhaustion with other
   * dot processes; `null` keeps it in this process only.
   */
  static readonly make = (rateLimitFile: string | null) =>
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      const gh = yield* Gh;

      const rateLimits = yield* RateLimit.cached(
        Duration.millis(RATE_LIMIT_TTL_MS),
      ).pipe(Effect.provideService(Gh, gh));

      const isAvailable = executor
        .exitCode("which", ["gh"])
        .pipe(Effect.map((code) => code === 0));

      const guard = (label: string) =>
        Effect.gen(function* () {
          const reset = rateLimitFile
            ? yield* readExhaustedUntil(rateLimitFile)
            : 0;

          const now = yield* Clock.currentTimeMillis;

          if (reset * 1000 - now > RATE_LIMIT_MAX_WAIT_SECONDS * 1000)
            return yield* exhaustedError(label, reset);

          yield* RateLimit.guard(rateLimits, {
            minRemaining: RATE_LIMIT_MIN_REMAINING,
            maxWait: Duration.seconds(RATE_LIMIT_MAX_WAIT_SECONDS),
          }).pipe(
            Effect.tapError((exhausted) =>
              rateLimitFile
                ? writeExhaustedUntil(rateLimitFile, exhausted.reset)
                : Effect.void,
            ),
            Effect.mapError((exhausted) =>
              exhaustedError(label, exhausted.reset),
            ),
          );
        });

      const attempt = <A, R>(
        label: string,
        operation: Effect.Effect<A, GhError, R>,
        checkRateLimit: boolean,
      ) =>
        (checkRateLimit ? guard(label) : Effect.void).pipe(
          Effect.andThen(
            operation.pipe(
              Effect.mapError((error) => toGitHubError(label, error)),
            ),
          ),
          Effect.tapError((error) =>
            error.rateLimited
              ? Cache.invalidate(rateLimits, "core")
              : Effect.void,
          ),
          Effect.provideService(Gh, gh),
        );

      const read: GitHubService["read"] = (label, operation, opts) =>
        attempt(label, operation, opts?.checkRateLimit !== false).pipe(
          Effect.retry({
            times: opts?.retries ?? DEFAULT_RETRIES,
            schedule: Schedule.exponential("1 second").pipe(
              Schedule.tap(({ duration }) =>
                Effect.sync(() =>
                  log(
                    `Retrying ${label} after ${Duration.toMillis(duration) / 1000}s`,
                  ),
                ),
              ),
            ),
            while: (error) => error.retryable,
          }),
          Effect.withSpan("GitHub.read", { attributes: { label } }),
        );

      const write: GitHubService["write"] = (label, operation, opts) =>
        attempt(label, operation, opts?.checkRateLimit !== false).pipe(
          Effect.withSpan("GitHub.write", { attributes: { label } }),
        );

      return GitHub.of({ isAvailable, read, write });
    });

  static readonly layer = Layer.effect(GitHub, GitHub.make(RATE_LIMIT_FILE));
}

/** The authenticated user's login. Run it through {@link GitHubService.read}. */
export const viewerLogin = Api.json(
  { endpoint: "user", method: "GET" },
  Schema.Struct({ login: Schema.String }),
).pipe(Effect.map((viewer) => viewer.login));

/** Map an effect-gh failure into the GitHub domain error. */
export function toGitHubError(label: string, error: GhError): GitHubError {
  const { exitCode, stderr } = Match.value(error).pipe(
    Match.tag("GhCommandError", (error) => ({
      exitCode: error.exitCode,
      stderr: error.stderr.trim(),
    })),
    Match.tag("GhTimeoutError", (error) => ({
      exitCode: 1,
      stderr: `gh timed out after ${error.timeoutMs}ms`,
    })),
    Match.tag("GhOutputLimitError", (error) => ({
      exitCode: 1,
      stderr: `gh output passed ${error.limitBytes} bytes`,
    })),
    Match.orElse((error) => ({
      exitCode: 1,
      stderr: formatCause(error.cause),
    })),
  );

  return new GitHubError({
    command: label,
    exitCode,
    stderr,
    retryable: isTransient(error),
    rateLimited: isRateLimited(error),
  });
}
