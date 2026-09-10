import { Clock, Context, Cron, Effect, Layer, Schema } from "effect";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import {
  managedGitRepos,
  type GitManagedRepo,
} from "../../services/GitConfig.js";
import { formatCause } from "../../lib/schema.js";
import { GitHub } from "./GitHub.js";
import {
  nextReleaseTag,
  publishRelease,
  type ReleasePublishAction,
  type ReleasePublishResult,
  type ReleaseProgress,
} from "../release/publish.js";
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
  /** Eligible candidate retained for future explicit desktop delivery. */
  readonly pending: string | null;
  /** The comparison contains release-relevant changes. */
  readonly needsAttention: boolean;
  /** Desktop delivery failure, separate from stale comparison errors. */
  readonly deliveryError: string | null;
  /** Configured future delivery preferences. */
  readonly notifications: ReleaseSettings["notifications"];
  /** A local programmatic publishing recipe is available. */
  readonly publishAvailable: boolean;
  /** Authoritative proposed tag, or null when no valid release can be proposed. */
  readonly nextVersion: string | null;
}

/** CLI and panel operations with opt-in desktop delivery. */
export interface GitReleasesService {
  /** Return per-repository snapshots and failures without losing other results. */
  readonly query: (
    options: ReleaseQuery,
  ) => Effect.Effect<readonly ReleaseEntry[], ReleaseError>;
  /** Persist an evidence-bound local impact review. */
  readonly action: (
    action: ReleaseAction,
  ) => Effect.Effect<ReleaseEntry, ReleaseError>;
  /** Preview a release, or execute its explicitly confirmed plan with progress. */
  readonly publish: (
    action: ReleasePublishAction,
    progress: ReleaseProgress,
  ) => Effect.Effect<ReleasePublishResult, ReleaseError>;
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
    settings.source_excludes ?? [],
    settings.source_minor_threshold ?? null,
    settings.versioning ?? "semver",
  ]);
}

function entry(
  repo: GitManagedRepo,
  settings: ReleaseSettings,
  cache: ReleaseCache,
  review: ReleaseReviewState,
  configPath: string,
  timestamp: number,
): ReleaseEntry {
  const snapshot = cache.snapshot
    ? applyReleaseReview(cache.snapshot, review)
    : null;
  const changed =
    snapshot !== null &&
    (snapshot.branch !== settings.branch ||
      snapshot.policyId !== policyIdentity(settings));
  const stale = cache.error !== null || changed;
  let nextVersion: string | null = null;
  if (snapshot?.complete && !stale) {
    try {
      nextVersion = nextReleaseTag(snapshot, settings.versioning, timestamp);
    } catch (error) {
      if (!(error instanceof ReleaseError)) throw error;
    }
  }
  return {
    repo: repo.github,
    name: repo.name,
    path: repo.path,
    configPath,
    branch: settings.branch,
    snapshot,
    stale,
    error:
      cache.error ??
      (changed
        ? "Release policy or branch changed; refresh the comparison"
        : null),
    attemptedAt: cache.attemptedAt,
    pending: review.pending,
    needsAttention: snapshot !== null && snapshot.suggestion !== "none",
    deliveryError: review.deliveryError ?? null,
    notifications: settings.notifications,
    publishAvailable: settings.publish !== undefined,
    nextVersion,
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
                entry(
                  repo,
                  settings,
                  cache,
                  review,
                  config.gitConfig.filePath,
                  now,
                ).stale,
              );
            if (options.notify && cache.snapshot)
              review = yield* deliverReleaseNotification(
                applyReleaseReview(cache.snapshot, review),
                review,
                settings,
                entry(
                  repo,
                  settings,
                  cache,
                  review,
                  config.gitConfig.filePath,
                  now,
                ).stale,
              ).pipe(Effect.provideService(CommandExecutor, executor));
            yield* saveReleaseDocument(paths.state, "review.json", review);
            yield* saveReleaseDocument(paths.cache, "snapshot.json", cache);
            return entry(
              repo,
              settings,
              cache,
              review,
              config.gitConfig.filePath,
              now,
            );
          }),
        );
      });

      const query = Effect.fn("GitReleases.query")(function* (
        options: ReleaseQuery,
      ) {
        const repositories = yield* select(options.repo);
        const now = yield* Clock.currentTimeMillis;
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
                      now,
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
                      pending: null,
                      needsAttention: false,
                      deliveryError: null,
                      notifications: settings.notifications,
                      publishAvailable: settings.publish !== undefined,
                      nextVersion: null,
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
            const now = yield* Clock.currentTimeMillis;
            const current = entry(
              repo,
              settings,
              cache,
              review,
              config.gitConfig.filePath,
              now,
            );
            if (current.stale || !current.snapshot?.complete)
              return yield* new ReleaseError({
                message:
                  "Release evidence is stale or incomplete; refresh before reviewing",
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
                reviewRelease(snapshot, review, action.target, action.impact),
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
              now,
            );
          }),
        );
      });
      const publish = Effect.fn("GitReleases.publish")(function* (
        action: ReleasePublishAction,
        progress: ReleaseProgress,
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
            const now = yield* Clock.currentTimeMillis;
            const current = entry(
              repo,
              settings,
              cache,
              review,
              config.gitConfig.filePath,
              now,
            );
            if (
              current.stale ||
              !current.snapshot?.complete ||
              current.snapshot.id !== action.snapshot
            )
              return yield* new ReleaseError({
                message:
                  "Release evidence changed or is incomplete; refresh before creating a release",
              });
            return yield* publishRelease(
              repo,
              settings,
              current.snapshot,
              action.confirm,
              progress,
            ).pipe(
              Effect.provideService(CommandExecutor, executor),
              Effect.provideService(GitHub, github),
            );
          }),
        );
      });
      return { query, action, publish };
    }),
  );
}
