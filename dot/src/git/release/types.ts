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

/** JSON manifest path or an explicit Python setup version source. */
export const ReleaseVersionFile = Schema.Union([
  Schema.String,
  Schema.Struct({
    /** Repository-relative setup.py path. */
    path: Schema.String,
    /** Literal keyword version in a setup call. */
    format: Schema.Literal("python-setup"),
  }),
]);

/** Supported version sources for release preparation. */
export type ReleaseVersionFile = typeof ReleaseVersionFile.Type;

/** Optional per-repository release watcher configuration. */
export const ReleaseSettings = Schema.Struct({
  /** Enable release comparisons. */
  enabled: Schema.Boolean,
  /** Five-field cron in local time. */
  schedule: Schema.String,
  /** Remote branch to compare with the published stable release. */
  branch: Schema.String,
  /** Portable shipped-content policy. */
  policy: Schema.Literals(["oxlint-rules", "system-bridge", "application"]),
  /** Stable tag scheme; omission retains SemVer. */
  versioning: Schema.optional(
    Schema.Literals(["semver", "calver", "fork", "fork-base-js"]),
  ),
  /** Upstream version source and fork-specific release counter prefix. */
  fork: Schema.optional(
    Schema.Struct({
      /** GitHub owner/repo whose plain SemVer tags, or merged package.json for fork-base-js, define the base. */
      upstream: Schema.String.check(
        Schema.isPattern(
          /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/,
        ),
      ),
      /** Non-numeric SemVer prerelease identifier. */
      suffix: Schema.String.check(
        Schema.isPattern(/^(?![0-9]+$)[0-9A-Za-z-]+$/),
      ),
    }),
  ),
  /** Changed source lines above this cutoff suggest minor; omission disables the heuristic. */
  source_minor_threshold: Schema.optional(Schema.Finite),
  /** Paths excluded from the source-size heuristic; new paths count by default. */
  source_excludes: Schema.optional(Schema.Array(Schema.String)),
  /** First-match rules applied before the preset. */
  overrides: Schema.optional(Schema.Array(ReleaseRule)),
  /** Explicit local recipe for confirmed, programmatic releases. */
  publish: Schema.optional(
    Schema.Struct({
      /** Version sources which must match the new tag. */
      version_files: Schema.Array(ReleaseVersionFile),
      /** Tracked files the commands may regenerate, such as lockfiles, committed with the version bump. */
      generated_files: Schema.optional(Schema.Array(Schema.String)),
      /** Ordered preparation and validation commands, each an argv array. */
      commands: Schema.Array(Schema.Array(Schema.String)),
    }),
  ),
  /** Preferences retained for opt-in desktop delivery. */
  notifications: Schema.Struct({
    /** Whether future explicit delivery is enabled. */
    enabled: Schema.Boolean,
    /** Lowest impact eligible for delivery. */
    minimum_impact: Impact,
    /** Minimum delay between successful deliveries. */
    cooldown_minutes: Schema.Finite,
  }),
}).check(
  Schema.makeFilter((settings) =>
    (settings.versioning === "fork" ||
      settings.versioning === "fork-base-js") &&
    !settings.fork
      ? `versioning: ${settings.versioning} requires fork.upstream and fork.suffix`
      : undefined,
  ),
);

/** Validated release settings, absent for unwatched repositories. */
export type ReleaseSettings = typeof ReleaseSettings.Type;
