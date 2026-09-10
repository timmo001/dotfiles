import { Schema } from "effect";

/** Ordered release impacts, independent of dependency version numbers. */
export const Impact = Schema.Literals(["none", "patch", "minor", "major"]);
/** A policy or local review's release impact. */
export type Impact = typeof Impact.Type;

/** Dependency purpose in the shipped consumer. */
export const DependencyRole = Schema.Literals([
  "runtime",
  "peer",
  "development",
  "build",
  "unknown",
]);
/** A dependency's resolved purpose. */
export type DependencyRole = typeof DependencyRole.Type;

/** Ordered matching rule; fields are ANDed, values within a field are ORed. */
export const ReleaseRule = Schema.Struct({
  /** Repository-relative globs, including the old path for renames. */
  paths: Schema.optional(Schema.Array(Schema.String)),
  /** Net Git change types. */
  change_types: Schema.optional(
    Schema.Array(Schema.Literals(["added", "modified", "deleted", "renamed"])),
  ),
  /** Exact dependency names. */
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  /** Dependency purposes. */
  roles: Schema.optional(Schema.Array(DependencyRole)),
  /** Repository-relative submodule paths. */
  submodules: Schema.optional(Schema.Array(Schema.String)),
  /** Explicit commit-subject regular expressions. */
  subjects: Schema.optional(Schema.Array(Schema.String)),
  /** Suggested consumer release impact. */
  impact: Impact,
  /** Human-readable explanation. */
  reason: Schema.String,
});
/** One ordered classification rule. */
export type ReleaseRule = typeof ReleaseRule.Type;

/** Optional per-repository release watcher configuration. */
export const ReleaseSettings = Schema.Struct({
  /** Enable release comparisons. */
  enabled: Schema.Boolean,
  /** Five-field cron in local time. */
  schedule: Schema.String,
  /** Remote branch to compare with the published stable release. */
  branch: Schema.String,
  /** Portable shipped-content policy. */
  policy: Schema.Literals(["oxlint-rules", "system-bridge"]),
  /** First-match rules applied before the preset. */
  overrides: Schema.optional(Schema.Array(ReleaseRule)),
  /** Preferences retained for opt-in desktop delivery. */
  notifications: Schema.Struct({
    /** Whether future explicit delivery is enabled. */
    enabled: Schema.Boolean,
    /** Lowest impact eligible for delivery. */
    minimum_impact: Impact,
    /** Minimum delay between successful deliveries. */
    cooldown_minutes: Schema.Number,
  }),
});
/** Validated release settings, absent for unwatched repositories. */
export type ReleaseSettings = typeof ReleaseSettings.Type;

/** Immutable net evidence collected from Git objects and committed manifests. */
export const ReleaseFact = Schema.Struct({
  /** Stable hash of actual evidence, excluding head and timestamps. */
  id: Schema.String,
  /** Evidence category. */
  kind: Schema.Literals([
    "file",
    "dependency",
    "metadata",
    "submodule",
    "commit",
    "checksum",
  ]),
  /** Repository-relative path. */
  path: Schema.String,
  /** Previous name when renamed. */
  previousPath: Schema.NullOr(Schema.String),
  /** Net change type. */
  changeType: Schema.Literals(["added", "modified", "deleted", "renamed"]),
  /** Old object identity or canonical dependency value. */
  before: Schema.NullOr(Schema.String),
  /** New object identity or canonical dependency value. */
  after: Schema.NullOr(Schema.String),
  /** Dependency name, when relevant. */
  dependency: Schema.NullOr(Schema.String),
  /** Dependency purpose, when relevant. */
  role: Schema.NullOr(DependencyRole),
  /** Owning submodule, when relevant. */
  submodule: Schema.NullOr(Schema.String),
  /** Explicit commit subject, when relevant. */
  subject: Schema.NullOr(Schema.String),
  /** Subjects attributed to surviving net content; absent in older cached evidence. */
  subjects: Schema.optional(Schema.Array(Schema.String)),
  /** Short evidence description. */
  detail: Schema.String,
  /** Whether all evidence needed to classify this fact was obtained. */
  complete: Schema.Boolean,
  /** Immutable upstream comparison link; absent in older cached evidence. */
  evidenceUrl: Schema.optional(Schema.String),
});
/** One immutable change fact. */
export type ReleaseFact = typeof ReleaseFact.Type;

/** A classified fact with its automatic and reviewed impacts. */
export const ReleaseFinding = Schema.Struct({
  ...ReleaseFact.fields,
  /** First matching policy's suggestion. */
  automaticImpact: Impact,
  /** Effective impact after local review. */
  impact: Impact,
  /** Why the policy classified this fact. */
  reason: Schema.String,
  /** Whether this exact evidence has a local override. */
  reviewed: Schema.Boolean,
});
/** Classified release evidence. */
export type ReleaseFinding = typeof ReleaseFinding.Type;

/** Commit summary from the complete immutable range. */
export const ReleaseCommit = Schema.Struct({
  /** Full commit ID. */
  id: Schema.String,
  /** First line of the message. */
  subject: Schema.String,
  /** Committer timestamp. */
  date: Schema.String,
  /** Submodule path for upstream commits, otherwise null. */
  submodule: Schema.NullOr(Schema.String),
  /** Immutable upstream commit link; absent in older cached summaries. */
  url: Schema.optional(Schema.String),
});
/** Immutable commit summary. */
export type ReleaseCommit = typeof ReleaseCommit.Type;

/** Persisted successful or evidence-incomplete comparison. */
export const ReleaseSnapshot = Schema.Struct({
  /** Display identity required by local actions. */
  id: Schema.String,
  /** GitHub repository identity. */
  repo: Schema.String,
  /** Configured display name. */
  name: Schema.String,
  /** Watched branch. */
  branch: Schema.String,
  /** Published stable release tag. */
  releaseTag: Schema.String,
  /** Peeled immutable release commit. */
  releaseCommit: Schema.String,
  /** Immutable compared branch commit. */
  head: Schema.String,
  /** Successful collection time in ISO format. */
  checkedAt: Schema.String,
  /** Hash of preset version and ordered overrides. */
  policyId: Schema.String,
  /** Release-relevant evidence identity for overall reviews. */
  comparisonId: Schema.String,
  /** Effective release candidate identity for acknowledgement and delivery. */
  notificationId: Schema.String,
  /** Immutable GitHub comparison link. */
  url: Schema.String,
  /** Full local and upstream commit summaries. */
  commits: Schema.Array(ReleaseCommit),
  /** All findings, including quiet evidence. */
  findings: Schema.Array(ReleaseFinding),
  /** Full net file changes, including files with no classified semantic changes. */
  files: Schema.optional(Schema.Array(ReleaseFact)),
  /** Automatic highest impact. */
  automaticSuggestion: Impact,
  /** Highest impact after local review. */
  suggestion: Impact,
  /** Overall review applies to this evidence. */
  reviewed: Schema.Boolean,
  /** False when evidence is missing; never a claim that no release is needed. */
  complete: Schema.Boolean,
  /** Missing evidence explanations. */
  errors: Schema.Array(Schema.String),
});
/** Complete CLI review snapshot. */
export type ReleaseSnapshot = typeof ReleaseSnapshot.Type;

/** Local evidence-bound reviews and future notification delivery bookkeeping. */
export const ReleaseReviewState = Schema.Struct({
  /** Exact evidence IDs mapped to explicit impacts. */
  findings: Schema.Record(Schema.String, Impact),
  /** Overall decision bound to a release-relevant comparison. */
  overall: Schema.NullOr(
    Schema.Struct({ comparisonId: Schema.String, impact: Impact }),
  ),
  /** Last acknowledged effective candidate. */
  acknowledged: Schema.NullOr(Schema.String),
  /** Candidate awaiting explicit delivery, retained during cooldown. */
  pending: Schema.NullOr(Schema.String),
  /** Last successfully delivered candidate. */
  delivered: Schema.NullOr(Schema.String),
  /** Last successful delivery time. */
  deliveredAt: Schema.NullOr(Schema.String),
  /** Bounded last delivery failure, separate from comparison freshness. */
  deliveryError: Schema.optional(Schema.NullOr(Schema.String)),
});
/** Persisted local decisions. */
export type ReleaseReviewState = typeof ReleaseReviewState.Type;

/** Cache envelope retains the last snapshot when a subsequent attempt fails. */
export const ReleaseCache = Schema.Struct({
  /** Last available comparison, including incomplete evidence. */
  snapshot: Schema.NullOr(ReleaseSnapshot),
  /** Last attempted schedule minute, claimed under the repository lock. */
  attemptedMinute: Schema.NullOr(Schema.Number),
  /** Last attempted check time. */
  attemptedAt: Schema.NullOr(Schema.String),
  /** Latest scan failure, without discarding previous evidence. */
  error: Schema.NullOr(Schema.String),
});
/** On-disk cache envelope. */
export type ReleaseCache = typeof ReleaseCache.Type;

/** Release watcher boundary error. */
export class ReleaseError extends Schema.TaggedError<ReleaseError>()(
  "ReleaseError",
  {
    /** Readable failure or stale-action guidance. */
    message: Schema.String,
  },
) {}
