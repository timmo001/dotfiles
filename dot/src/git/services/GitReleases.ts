import { Clock, Context, Cron, Effect, Layer, Schema } from "effect";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import {
  managedGitRepos,
  type GitManagedRepo,
} from "../../services/GitConfig.js";
import { formatCause } from "../../lib/schema.js";
import { GitHub } from "./GitHub.js";
import { collectReleaseChanges, evidenceId } from "../release/changes.js";
import {
  classifyReleaseFacts,
  highestImpact,
  RELEASE_POLICY_VERSION,
} from "../release/policy.js";
import {
  applyReleaseReview,
  acceptReleaseSnapshot,
  assertReleaseSelection,
  readReleaseState,
  releaseNotificationState,
  releasePaths,
  reviewRelease,
  saveReleaseDocument,
  withReleaseLock,
} from "../release/state.js";
import {
  ReleaseError,
  type Impact,
  type ReleaseCache,
  type ReleaseReviewState,
  type ReleaseSettings,
  type ReleaseSnapshot,
} from "../release/types.js";

/** Selection and scheduling for release inspection. */
export interface ReleaseQuery {
  /** Configured name or GitHub slug, otherwise all enabled repositories. */
  readonly repo?: string;
  /** Bypass the cron gate and refresh immutable remote refs. */
  readonly refresh?: boolean;
  /** Only scan in a due cron minute not already attempted. */
  readonly scheduled?: boolean;
  /** Explicit opt-in to eligible desktop delivery. */
  readonly notify?: boolean;
}

/** Local action against the exact displayed snapshot. */
export interface ReleaseAction {
  /** Configured name or GitHub slug. */
  readonly repo: string;
  /** Displayed snapshot ID. */
  readonly snapshot: string;
  /** Local acknowledgement or impact review. */
  readonly action: "review" | "acknowledge";
  /** Finding ID or overall. */
  readonly target: string;
  /** Explicit choice, or auto to clear it. */
  readonly impact: Impact | "auto";
}

/** Repository panel entry, preserving old evidence during failures. */
export interface ReleaseEntry {
  /** Repository identity. */
  readonly repo: string;
  /** Configured display name. */
  readonly name: string;
  /** Current checkout path from private configuration, never cached. */
  readonly path: string;
  /** Current private policy source, for the editor action. */
  readonly configPath: string;
  /** Configured branch, also available before the first comparison. */
  readonly branch: string;
  /** Last available comparison. */
  readonly snapshot: ReleaseSnapshot | null;
  /** Whether the last scan failed or the selected policy changed. */
  readonly stale: boolean;
  /** Latest scan or storage failure. */
  readonly error: string | null;
  /** Most recent attempted check. */
  readonly attemptedAt: string | null;
  /** Current evidence was locally acknowledged. */
  readonly acknowledged: boolean;
  /** Eligible candidate retained for future explicit desktop delivery. */
  readonly pending: string | null;
  /** Relevant unacknowledged evidence still needs local review. */
  readonly needsAttention: boolean;
  /** Desktop delivery failure, separate from stale comparison errors. */
  readonly deliveryError: string | null;
  /** Configured future delivery preferences. */
  readonly notifications: ReleaseSettings["notifications"];
}

/** CLI and panel operations with opt-in desktop delivery. */
export interface GitReleasesService {
  /** Return per-repository snapshots and failures without losing other results. */
  readonly query: (
    options: ReleaseQuery,
  ) => Effect.Effect<readonly ReleaseEntry[], ReleaseError>;
  /** Persist an evidence-bound local review or acknowledgement. */
  readonly action: (
    action: ReleaseAction,
  ) => Effect.Effect<ReleaseEntry, ReleaseError>;
}

const StableRelease = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  published_at: Schema.NullOr(Schema.String),
});

function policyIdentity(settings: ReleaseSettings): string {
  return evidenceId([
    RELEASE_POLICY_VERSION,
    settings.policy,
    settings.overrides ?? [],
  ]);
}

function entry(
  repo: GitManagedRepo,
  settings: ReleaseSettings,
  cache: ReleaseCache,
  review: ReleaseReviewState,
  configPath: string,
): ReleaseEntry {
  const snapshot = cache.snapshot
    ? applyReleaseReview(cache.snapshot, review)
    : null;
  const changed =
    snapshot !== null &&
    (snapshot.branch !== settings.branch ||
      snapshot.policyId !== policyIdentity(settings));
  return {
    repo: repo.github,
    name: repo.name,
    path: repo.path,
    configPath,
    branch: settings.branch,
    snapshot,
    stale: cache.error !== null || changed,
    error:
      cache.error ??
      (changed
        ? "Release policy or branch changed; refresh the comparison"
        : null),
    attemptedAt: cache.attemptedAt,
    acknowledged:
      snapshot !== null && review.acknowledged === snapshot.notificationId,
    pending: review.pending,
    needsAttention:
      snapshot !== null &&
      snapshot.suggestion !== "none" &&
      review.acknowledged !== snapshot.notificationId,
    deliveryError: review.deliveryError ?? null,
    notifications: settings.notifications,
  };
}

/** Deliver an eligible candidate under the caller's repository lock; failed sends retain it. */
export const deliverReleaseNotification = Effect.fn("GitReleases.deliver")(
  function* (
    snapshot: ReleaseSnapshot,
    review: ReleaseReviewState,
    settings: ReleaseSettings,
    stale: boolean,
  ) {
    const current = releaseNotificationState(snapshot, review, settings, stale);
    const now = yield* Clock.currentTimeMillis;
    if (
      !current.pending ||
      (current.deliveredAt !== null &&
        now - Date.parse(current.deliveredAt) <
          settings.notifications.cooldown_minutes * 60000)
    )
      return current;
    const executor = yield* CommandExecutor;
    const finding =
      snapshot.findings.find(
        (finding) => finding.impact === snapshot.suggestion,
      ) ?? snapshot.findings.find((finding) => finding.impact !== "none");
    const reason = snapshot.reviewed
      ? "Local overall release choice"
      : finding
        ? `${finding.detail}: ${finding.reason}`
        : "Unreleased changes need review";
    const sent = yield* executor
      .run("omarchy", [
        "notification",
        "send",
        "--app-name",
        "Git releases",
        "--urgency",
        "normal",
        `${snapshot.name}: ${snapshot.suggestion} release suggested`,
        `Changes: ${reason.replace(/\s+/g, " ").slice(0, 180)}`,
        "--exec",
        "dot",
        "git-releases",
        "--open",
        "--repo",
        snapshot.repo,
      ])
      .pipe(Effect.timeout("15 seconds"), Effect.result);
    if (sent._tag === "Failure")
      return {
        ...current,
        deliveryError: `Notification delivery failed: ${formatCause(sent.failure).replace(/\s+/g, " ").slice(0, 240)}`,
      };
    return {
      ...current,
      pending: null,
      delivered: current.pending,
      deliveredAt: new Date(now).toISOString(),
      deliveryError: null,
    };
  },
);

/** Effect service for {@link GitReleasesService}. */
export class GitReleases extends Context.Service<
  GitReleases,
  GitReleasesService
>()("GitReleases") {
  static readonly layer = Layer.effect(
    GitReleases,
    Effect.gen(function* () {
      const config = yield* Config;
      const github = yield* GitHub;
      const executor = yield* CommandExecutor;

      const select = (selection?: string) =>
        Effect.try({
          try: () => {
            if (!config.gitConfig.valid)
              throw new ReleaseError({
                message: config.gitConfig.diagnostics.join("\n"),
              });
            const repositories = managedGitRepos(config.gitConfig).filter(
              (repo) =>
                repo.releases?.enabled &&
                (!selection ||
                  [repo.name, repo.github].some(
                    (name) => name.toLowerCase() === selection.toLowerCase(),
                  )),
            );
            if (selection && repositories.length !== 1)
              throw new ReleaseError({
                message: `No unique enabled release repository matches ${selection}`,
              });
            return repositories;
          },
          catch: (error) =>
            error instanceof ReleaseError
              ? error
              : new ReleaseError({ message: formatCause(error) }),
        });

      const scan = Effect.fn("GitReleases.scan")(function* (
        repo: GitManagedRepo,
        settings: ReleaseSettings,
      ) {
        const metadata = yield* github
          .json(["api", `repos/${repo.github}/releases/latest`])
          .pipe(
            Effect.mapError(
              (error) => new ReleaseError({ message: error.stderr }),
            ),
          );
        const release = yield* Schema.decodeUnknownEffect(StableRelease)(
          metadata,
        ).pipe(
          Effect.mapError(
            (error) =>
              new ReleaseError({
                message: `Invalid stable release metadata: ${formatCause(error)}`,
              }),
          ),
        );
        if (release.draft || release.prerelease || !release.published_at)
          return yield* new ReleaseError({
            message: "No published stable release is available",
          });
        const runGit = (args: readonly string[]) =>
          executor
            .run("git", args, {
              cwd: repo.path,
              env: { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
            })
            .pipe(
              Effect.mapError(
                (error) =>
                  new ReleaseError({ message: error.stderr || error.command }),
              ),
            );
        yield* runGit(["check-ref-format", `refs/tags/${release.tag_name}`]);
        yield* runGit(["check-ref-format", `refs/heads/${settings.branch}`]);
        const prefix = `refs/dot/git-releases/${evidenceId(repo.github)}`;
        yield* runGit([
          "fetch",
          "--atomic",
          "--no-write-fetch-head",
          "--no-tags",
          "--no-recurse-submodules",
          `https://github.com/${repo.github}.git`,
          `+refs/tags/${release.tag_name}:${prefix}/release`,
          `+refs/heads/${settings.branch}:${prefix}/head`,
        ]);
        const releaseCommit = (yield* runGit([
          "rev-parse",
          "--verify",
          `${prefix}/release^{commit}`,
        ])).trim();
        const head = (yield* runGit([
          "rev-parse",
          "--verify",
          `${prefix}/head^{commit}`,
        ])).trim();
        const ancestor = yield* executor.exitCode(
          "git",
          ["merge-base", "--is-ancestor", releaseCommit, head],
          { cwd: repo.path },
        );
        if (ancestor !== 0)
          return yield* new ReleaseError({
            message: `Published release ${release.tag_name} is not an ancestor of ${settings.branch}, or history is unavailable`,
          });
        const changes = yield* collectReleaseChanges(
          repo.path,
          releaseCommit,
          head,
          settings,
          releasePaths(repo.github).cache,
        ).pipe(Effect.provideService(CommandExecutor, executor));
        const findings = classifyReleaseFacts(changes.facts, settings);
        const now = yield* Clock.currentTimeMillis;
        return {
          id: "",
          repo: repo.github,
          name: repo.name,
          branch: settings.branch,
          releaseTag: release.tag_name,
          releaseCommit,
          head,
          checkedAt: new Date(now).toISOString(),
          policyId: policyIdentity(settings),
          comparisonId: "",
          notificationId: "",
          url: `https://github.com/${repo.github}/compare/${releaseCommit}...${head}`,
          commits: changes.commits,
          findings,
          files: changes.files,
          automaticSuggestion: highestImpact(
            findings.map((fact) => fact.automaticImpact),
          ),
          suggestion: "none",
          reviewed: false,
          complete:
            changes.errors.length === 0 &&
            findings.every((fact) => fact.complete),
          errors: changes.errors,
        } satisfies ReleaseSnapshot;
      });

      const queryRepo = Effect.fn("GitReleases.queryRepo")(function* (
        repo: GitManagedRepo,
        settings: ReleaseSettings,
        options: ReleaseQuery,
      ) {
        const paths = releasePaths(repo.github);
        return yield* withReleaseLock(
          paths,
          Effect.gen(function* () {
            let { cache, review } = yield* readReleaseState(paths);
            const now = yield* Clock.currentTimeMillis;
            const minute = Math.floor(now / 60000);
            const scheduled =
              options.scheduled &&
              cache.attemptedMinute !== minute &&
              Cron.match(
                Cron.parseUnsafe(
                  settings.schedule,
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                ),
                new Date(now),
              );
            const shouldScan =
              options.refresh ||
              scheduled ||
              (!options.scheduled && cache.attemptedAt === null);
            if (shouldScan) {
              cache = {
                ...cache,
                attemptedMinute: minute,
                attemptedAt: new Date(now).toISOString(),
                error:
                  "Release comparison is pending or was interrupted; refresh to retry",
              };
              yield* saveReleaseDocument(paths.cache, "snapshot.json", cache);
              const result = yield* scan(repo, settings).pipe(
                Effect.timeout("3 minutes"),
                Effect.mapError(
                  (error) => new ReleaseError({ message: formatCause(error) }),
                ),
                Effect.result,
              );
              if (result._tag === "Success") {
                ({ cache, review } = acceptReleaseSnapshot(
                  cache,
                  review,
                  result.success,
                ));
              } else cache = { ...cache, error: result.failure.message };
            }
            if (cache.snapshot)
              review = releaseNotificationState(
                applyReleaseReview(cache.snapshot, review),
                review,
                settings,
                entry(repo, settings, cache, review, config.gitConfig.filePath)
                  .stale,
              );
            if (options.notify && cache.snapshot)
              review = yield* deliverReleaseNotification(
                applyReleaseReview(cache.snapshot, review),
                review,
                settings,
                entry(repo, settings, cache, review, config.gitConfig.filePath)
                  .stale,
              ).pipe(Effect.provideService(CommandExecutor, executor));
            yield* saveReleaseDocument(paths.state, "review.json", review);
            yield* saveReleaseDocument(paths.cache, "snapshot.json", cache);
            return entry(
              repo,
              settings,
              cache,
              review,
              config.gitConfig.filePath,
            );
          }),
        );
      });

      const query = Effect.fn("GitReleases.query")(function* (
        options: ReleaseQuery,
      ) {
        const repositories = yield* select(options.repo);
        return yield* Effect.forEach(
          repositories,
          (repo) => {
            const settings = repo.releases;
            if (!settings)
              return Effect.fail(
                new ReleaseError({ message: "Release settings missing" }),
              );
            return queryRepo(repo, settings, options).pipe(
              Effect.catch((error) =>
                readReleaseState(releasePaths(repo.github)).pipe(
                  Effect.map(({ cache, review }) =>
                    entry(
                      repo,
                      settings,
                      { ...cache, error: error.message },
                      { ...review, pending: null },
                      config.gitConfig.filePath,
                    ),
                  ),
                  Effect.catch(() =>
                    Effect.succeed({
                      repo: repo.github,
                      name: repo.name,
                      path: repo.path,
                      configPath: config.gitConfig.filePath,
                      branch: settings.branch,
                      snapshot: null,
                      stale: true,
                      error: error.message,
                      attemptedAt: null,
                      acknowledged: false,
                      pending: null,
                      needsAttention: false,
                      deliveryError: null,
                      notifications: settings.notifications,
                    } satisfies ReleaseEntry),
                  ),
                ),
              ),
            );
          },
          { concurrency: 2 },
        );
      });

      const action = Effect.fn("GitReleases.action")(function* (
        action: ReleaseAction,
      ) {
        const repositories = yield* select(action.repo);
        const repo = repositories[0];
        const settings = repo.releases;
        if (!settings)
          return yield* new ReleaseError({
            message: "Release settings missing",
          });
        const paths = releasePaths(repo.github);
        return yield* withReleaseLock(
          paths,
          Effect.gen(function* () {
            const { cache, review } = yield* readReleaseState(paths);
            const current = entry(
              repo,
              settings,
              cache,
              review,
              config.gitConfig.filePath,
            );
            if (current.stale || !current.snapshot?.complete)
              return yield* new ReleaseError({
                message:
                  "Release evidence is stale or incomplete; refresh before reviewing or acknowledging",
              });
            const snapshot = current.snapshot;
            yield* Effect.try({
              try: () => assertReleaseSelection(snapshot, action.snapshot),
              catch: (error) =>
                error instanceof ReleaseError
                  ? error
                  : new ReleaseError({ message: formatCause(error) }),
            });
            let updated = yield* Effect.try({
              try: () =>
                action.action === "acknowledge"
                  ? { ...review, acknowledged: snapshot.notificationId }
                  : reviewRelease(
                      snapshot,
                      review,
                      action.target,
                      action.impact,
                    ),
              catch: (error) =>
                error instanceof ReleaseError
                  ? error
                  : new ReleaseError({ message: formatCause(error) }),
            });
            const reviewed = applyReleaseReview(snapshot, updated);
            updated = releaseNotificationState(
              reviewed,
              updated,
              settings,
              false,
            );
            // Reviews are authoritative; a scan cache never overwrites them.
            yield* saveReleaseDocument(paths.state, "review.json", updated);
            return entry(
              repo,
              settings,
              cache,
              updated,
              config.gitConfig.filePath,
            );
          }),
        );
      });
      return { query, action };
    }),
  );
}
