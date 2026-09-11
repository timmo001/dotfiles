import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Schedule, Schema } from "effect";
import { CACHE_DIR, STATE_DIR } from "../../lib/paths.js";
import { formatCause } from "../../lib/schema.js";
import { evidenceId } from "./changes.js";
import { highestImpact } from "./policy.js";
import {
  ReleaseCache,
  ReleaseError,
  ReleaseReviewState,
  type Impact,
  type ReleaseSettings,
  type ReleaseSnapshot,
} from "./types.js";

/** Repository-specific storage roots; private values never enter public policy. */
export function releasePaths(
  repo: string,
  cacheRoot = CACHE_DIR,
  stateRoot = STATE_DIR,
) {
  const key = evidenceId(repo.toLowerCase());

  return {
    cache: join(cacheRoot, "dot", "git-releases", key),
    state: join(stateRoot, "dot", "git-releases", key),
  };
}

/** Empty durable local decisions. */
export function emptyReleaseReview(): ReleaseReviewState {
  return {
    findings: {},
    overall: null,
    pending: null,
    delivered: null,
    deliveredAt: null,
  };
}

/** Empty cache before the first scheduled or manual scan. */
export function emptyReleaseCache(): ReleaseCache {
  return {
    snapshot: null,
    attemptedMinute: null,
    attemptedAt: null,
    error: null,
  };
}

/** Accept only complete evidence as a new review baseline; failures retain all local decisions. */
export function acceptReleaseSnapshot(
  cache: ReleaseCache,
  review: ReleaseReviewState,
  candidate: ReleaseSnapshot,
) {
  if (!candidate.complete) {
    return {
      cache: {
        ...cache,
        snapshot: cache.snapshot?.complete
          ? cache.snapshot
          : applyReleaseReview(candidate, review),
        error: `Incomplete release comparison: ${
          candidate.errors.join("; ") ||
          candidate.findings
            .filter((finding) => !finding.complete)
            .map((finding) => finding.detail)
            .join("; ") ||
          "missing evidence"
        }`,
      },
      review,
    };
  }

  const currentIds = new Set(candidate.findings.map((fact) => fact.id));

  const retained = {
    ...review,
    findings: Object.fromEntries(
      Object.entries(review.findings).filter(([id]) => currentIds.has(id)),
    ),
  };

  const snapshot = applyReleaseReview(candidate, retained);

  const previous = cache.snapshot
    ? applyReleaseReview(cache.snapshot, review)
    : null;

  // Policy upgrades may change automatic impact without changing the reviewed evidence.
  if (
    previous &&
    retained.overall?.comparisonId === previous.comparisonId &&
    releaseReviewEvidence(previous) === releaseReviewEvidence(snapshot)
  ) {
    const migrated = {
      ...retained,
      overall: { ...retained.overall, comparisonId: snapshot.comparisonId },
    };

    return {
      cache: {
        ...cache,
        snapshot: applyReleaseReview(candidate, migrated),
        error: null,
      },
      review: migrated,
    };
  }

  return {
    cache: { ...cache, snapshot, error: null },
    review:
      retained.overall &&
      retained.overall.comparisonId !== snapshot.comparisonId
        ? { ...retained, overall: null }
        : retained,
  };
}

function releaseReviewEvidence(snapshot: ReleaseSnapshot): string {
  return evidenceId([
    snapshot.repo,
    snapshot.branch,
    snapshot.releaseCommit,
    snapshot.findings
      .filter(
        (fact) =>
          fact.automaticImpact !== "none" ||
          fact.impact !== "none" ||
          fact.reviewed,
      )
      .map((fact) => fact.id)
      .sort(),
  ]);
}

/** Read validated cache and state while holding the repository lock. */
export const readReleaseState = Effect.fn("releases.readState")(function* (
  paths: ReturnType<typeof releasePaths>,
) {
  return yield* Effect.try({
    try: () => ({
      cache: existsSync(join(paths.cache, "snapshot.json"))
        ? Schema.decodeUnknownSync(ReleaseCache)(
            JSON.parse(
              readFileSync(join(paths.cache, "snapshot.json"), "utf8"),
            ),
          )
        : emptyReleaseCache(),
      review: existsSync(join(paths.state, "review.json"))
        ? Schema.decodeUnknownSync(ReleaseReviewState)(
            JSON.parse(readFileSync(join(paths.state, "review.json"), "utf8")),
          )
        : emptyReleaseReview(),
    }),
    catch: (error) =>
      new ReleaseError({
        message: `Could not read release state: ${formatCause(error)}`,
      }),
  });
});

/** Replace a JSON document atomically; callers serialise through the shared lock. */
export const saveReleaseDocument = Effect.fn("releases.saveDocument")(
  function* (
    directory: string,
    name: string,
    value: ReleaseCache | ReleaseReviewState,
  ) {
    yield* Effect.try({
      try: () => {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);

        try {
          writeFileSync(temporary, JSON.stringify(value), {
            mode: 0o600,
            flag: "wx",
          });
          renameSync(temporary, join(directory, name));
        } finally {
          if (existsSync(temporary)) unlinkSync(temporary);
        }
      },
      catch: (error) =>
        new ReleaseError({
          message: `Could not save release state: ${formatCause(error)}`,
        }),
    });
  },
);

/** Serialise scans and reviews with a kernel lock released even after a crash. */
export function withReleaseLock<A, E, R>(
  paths: ReturnType<typeof releasePaths>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ReleaseError, R> {
  const path = join(paths.state, "write.lock");

  return Effect.gen(function* () {
    const descriptor = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          mkdirSync(paths.state, { recursive: true, mode: 0o700 });

          return openSync(path, "a+", 0o600);
        },
        catch: (error) =>
          new ReleaseError({
            message: `Could not open release lock: ${formatCause(error)}`,
          }),
      }),
      (fd) => Effect.sync(() => closeSync(fd)),
    );

    const acquired = yield* Effect.try({
      try: () => {
        // The inherited descriptor shares the lock with this process. Keep the
        // file in place so concurrent callers always lock the same inode.
        const result = Bun.spawnSync(
          ["flock", "--exclusive", "--nonblock", "0"],
          {
            stdin: descriptor,
            stdout: "ignore",
            stderr: "pipe",
          },
        );

        if (result.exitCode === 0) return true;

        if (result.exitCode === 1) return false;
        throw new Error(result.stderr.toString().trim() || "flock failed");
      },
      catch: (error) =>
        new ReleaseError({
          message: `Could not lock release state: ${formatCause(error)}`,
        }),
    }).pipe(
      Effect.repeat({
        while: (locked) => !locked,
        times: 239,
        schedule: Schedule.spaced("250 millis"),
      }),
    );

    if (!acquired)
      return yield* new ReleaseError({
        message: `Release state is locked: ${path}. Wait for the active scan before retrying`,
      });

    return yield* effect;
  }).pipe(Effect.scoped);
}

/** Apply evidence-bound decisions and derive comparison, display and notification identities. */
export function applyReleaseReview(
  snapshot: ReleaseSnapshot,
  review: ReleaseReviewState,
): ReleaseSnapshot {
  const findings = snapshot.findings.map((fact) => ({
    ...fact,
    impact: review.findings[fact.id] ?? fact.automaticImpact,
    reviewed: review.findings[fact.id] !== undefined,
  }));

  const relevant = findings
    .filter(
      (fact) =>
        fact.automaticImpact !== "none" ||
        fact.impact !== "none" ||
        fact.reviewed,
    )
    .map((fact) => [fact.id, fact.automaticImpact])
    .sort(([a], [b]) => a.localeCompare(b));

  const comparisonId = evidenceId([
    snapshot.repo,
    snapshot.branch,
    snapshot.releaseCommit,
    snapshot.policyId,
    relevant,
  ]);

  const overall =
    review.overall?.comparisonId === comparisonId
      ? review.overall.impact
      : undefined;

  const suggestion =
    overall ?? highestImpact(findings.map((fact) => fact.impact));

  const notificationId = evidenceId([
    comparisonId,
    findings
      .filter(
        (fact) => fact.impact !== "none" || fact.automaticImpact !== "none",
      )
      .map((fact) => [fact.id, fact.impact])
      .sort(([a], [b]) => a.localeCompare(b)),
    suggestion,
  ]);

  const id = evidenceId([
    snapshot.repo,
    snapshot.branch,
    snapshot.releaseCommit,
    snapshot.head,
    snapshot.policyId,
    findings.map((fact) => [
      fact.id,
      fact.complete,
      fact.impact,
      fact.reviewed,
    ]),
    overall ?? null,
    snapshot.complete,
  ]);

  return {
    ...snapshot,
    findings,
    comparisonId,
    notificationId,
    id,
    suggestion,
    reviewed: overall !== undefined,
  };
}

/** Reject actions against a display that no longer represents the stored comparison. */
export function assertReleaseSelection(
  snapshot: ReleaseSnapshot | null,
  snapshotId: string,
): asserts snapshot is ReleaseSnapshot {
  if (!snapshot || snapshot.id !== snapshotId)
    throw new ReleaseError({
      message:
        "Release snapshot changed; refresh the overview and select the change again",
    });
}

/** Apply a finding or overall review; auto removes the corresponding local choice. */
export function reviewRelease(
  snapshot: ReleaseSnapshot,
  state: ReleaseReviewState,
  target: string,
  impact: Impact | "auto",
): ReleaseReviewState {
  if (target === "overall")
    return {
      ...state,
      overall:
        impact === "auto"
          ? null
          : { comparisonId: snapshot.comparisonId, impact },
    };

  if (!snapshot.findings.some((finding) => finding.id === target))
    throw new ReleaseError({
      message: "Finding is not in this snapshot; refresh the overview",
    });
  const findings = { ...state.findings };

  if (impact === "auto") delete findings[target];
  else findings[target] = impact;

  return { ...state, findings };
}

/** Record a pending delivery candidate without sending desktop notifications. */
export function releaseNotificationState(
  snapshot: ReleaseSnapshot,
  review: ReleaseReviewState,
  settings: ReleaseSettings,
  stale: boolean,
): ReleaseReviewState {
  const order: readonly Impact[] = ["none", "patch", "minor", "major"];

  const eligible =
    !stale &&
    snapshot.complete &&
    settings.notifications.enabled &&
    snapshot.suggestion !== "none" &&
    order.indexOf(snapshot.suggestion) >=
      order.indexOf(settings.notifications.minimum_impact) &&
    review.delivered !== snapshot.notificationId;

  return {
    ...review,
    pending: eligible ? snapshot.notificationId : null,
    deliveryError: eligible ? (review.deliveryError ?? null) : null,
  };
}
