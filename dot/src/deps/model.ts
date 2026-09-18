import { Schema } from "effect";

/** A discovery or provider failure that must remain visible in the preview. */
export class DependencyDiscoveryError extends Schema.TaggedError<DependencyDiscoveryError>()(
  "DependencyDiscoveryError",
  { message: Schema.String },
) {}

/** Immutable dependency occurrence extracted from a pinned source file. */
export const Dependency = Schema.Struct({
  manager: Schema.String,
  file: Schema.String,
  name: Schema.String,
  package: Schema.String,
  datasource: Schema.String,
  current: Schema.String,
  digest: Schema.optionalKey(Schema.String),
  resolved: Schema.optionalKey(Schema.String),
  /** Undefined needs discovery; null means the provider supplies no source repository. */
  sourceUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  dependencyType: Schema.String,
  versioning: Schema.optionalKey(Schema.String),
  extractVersion: Schema.optionalKey(Schema.String),
});

/** Decoded dependency occurrence. */
export interface Dependency extends Schema.Schema.Type<typeof Dependency> {}

/** Provider release metadata, decoded before version selection. */
export const Release = Schema.Struct({
  version: Schema.String,
  digest: Schema.optionalKey(Schema.String),
  date: Schema.optionalKey(Schema.String),
});

/** Decoded provider release. */
export interface Release extends Schema.Schema.Type<typeof Release> {}

/** Metadata shared by all occurrences of one upstream dependency. */
export const Releases = Schema.Struct({
  releases: Schema.Array(Release),
  latest: Schema.optionalKey(Schema.String),
  /** Null records confirmed absence; omitted metadata still needs resolution. */
  sourceUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

/** Decoded version lookup. */
export interface Releases extends Schema.Schema.Type<typeof Releases> {}

/** Immutable tree entry; gitlinks are never traversed. */
export const TreeEntry = Schema.Struct({
  path: Schema.String,
  mode: Schema.String,
  type: Schema.String,
  sha: Schema.String,
});

/** Decoded tree entry. */
export interface TreeEntry extends Schema.Schema.Type<typeof TreeEntry> {}

/** Pinned repository inputs, never read from the caller's mutable branch. */
export interface Snapshot {
  /** Exact hosting identity. */
  readonly repository: string;
  /** Target branch or immutable comparison label. */
  readonly target: string;
  /** Exact commit. */
  readonly sha: string;
  /** Complete repository tree. */
  readonly tree: readonly TreeEntry[];
  /** Selected manifest and policy contents. */
  readonly files: Readonly<Record<string, string>>;
  /** Isolated cached source directory, when saved by the live snapshot reader. */
  readonly directory?: string;
}

/** Extraction results retain unsupported inputs rather than dropping them. */
export interface Extraction {
  /** Successfully extracted occurrences. */
  readonly dependencies: readonly Dependency[];
  /** Inputs needing a supported adapter before publication. */
  readonly blockers: readonly string[];
}

/** Stable identity across base/head snapshots, independent of version and branch. */
export function dependencyIdentity(dependency: Dependency): string {
  return JSON.stringify([
    dependency.manager,
    dependency.file,
    dependency.dependencyType,
    dependency.name,
    dependency.package,
    dependency.datasource,
  ]);
}
