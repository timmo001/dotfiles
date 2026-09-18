import { createHash } from "node:crypto";
import { isAbsolute, normalize } from "node:path";
import { Effect, Predicate, Record, Schema } from "effect";
import type { Dependency } from "./model.js";
import { matchesPatterns, matchesRule } from "./rules.js";

/** Invalid native policy or incomplete Renovate conversion. */
export class DependencyConfigError extends Schema.TaggedError<DependencyConfigError>()(
  "DependencyConfigError",
  { message: Schema.String },
) {}

const Strings = Schema.Array(Schema.String);

const Settings = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  minimumReleaseAge: Schema.optionalKey(Schema.NullOr(Schema.String)),
  allowedVersions: Schema.optionalKey(Schema.NullOr(Schema.String)),
  versioning: Schema.optionalKey(Schema.NullOr(Schema.String)),
  extractVersion: Schema.optionalKey(Schema.NullOr(Schema.String)),
  rangeStrategy: Schema.optionalKey(Schema.String),
  pinDigests: Schema.optionalKey(Schema.Boolean),
  ignoreUnstable: Schema.optionalKey(Schema.Boolean),
  respectLatest: Schema.optionalKey(Schema.Boolean),
  separateMajorMinor: Schema.optionalKey(Schema.Boolean),
  separateMinorPatch: Schema.optionalKey(Schema.Boolean),
  separateMultipleMajor: Schema.optionalKey(Schema.Boolean),
  groupName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  groupSlug: Schema.optionalKey(Schema.NullOr(Schema.String)),
  priority: Schema.optionalKey(Schema.Int).annotate({
    description:
      "Higher values run first; a coordinated group uses its highest member priority.",
  }),
}).annotate({ identifier: "DependencySettings" });

const Rule = Schema.Struct({
  description: Schema.optionalKey(Strings),
  match: Schema.Struct({
    managers: Schema.optionalKey(Strings),
    datasources: Schema.optionalKey(Strings),
    packages: Schema.optionalKey(Strings),
    dependencies: Schema.optionalKey(Strings),
    files: Schema.optionalKey(Strings),
    dependencyTypes: Schema.optionalKey(Strings),
    sourceUrls: Schema.optionalKey(Strings),
    currentValues: Schema.optionalKey(Strings),
    currentVersions: Schema.optionalKey(Strings),
    updateTypes: Schema.optionalKey(Strings),
  }),
  set: Settings,
});

const Manager = Schema.Struct({
  files: Schema.optionalKey(Strings),
  settings: Settings,
});

const RegexManager = Schema.Struct({
  files: Strings,
  patterns: Strings,
  strategy: Schema.optionalKey(Schema.String),
  templates: Schema.Struct({
    datasource: Schema.optionalKey(Schema.String),
    dependency: Schema.optionalKey(Schema.String),
    package: Schema.optionalKey(Schema.String),
    value: Schema.optionalKey(Schema.String),
    versioning: Schema.optionalKey(Schema.String),
    extractVersion: Schema.optionalKey(Schema.String),
    replacement: Schema.optionalKey(Schema.String),
  }),
});

const Datasource = Schema.Struct({
  registry: Schema.String,
  format: Schema.String,
  transforms: Strings,
});

/** Ordered native policy layer; base rules run before repository overrides. */
export const DependencyPolicy = Schema.Struct({
  settings: Settings,
  enabledManagers: Schema.optionalKey(Strings),
  ignorePaths: Schema.optionalKey(Strings),
  ignoreDependencies: Schema.optionalKey(Strings),
  managers: Schema.Record(Schema.String, Manager),
  rules: Schema.Array(Rule),
  regexManagers: Schema.Array(RegexManager),
  datasources: Schema.Record(Schema.String, Datasource),
}).annotate({ identifier: "DependencyPolicy" });

/** Decoded native policy layer. */
export interface DependencyPolicy extends Schema.Schema.Type<
  typeof DependencyPolicy
> {}

/** Compose policy with replacement settings, appended rules and mergeable file/ignore lists. */
export function mergeDependencyPolicy(
  base: DependencyPolicy,
  overrides: DependencyPolicy,
): DependencyPolicy {
  return {
    settings: { ...base.settings, ...overrides.settings },
    ...Record.filter(
      {
        enabledManagers: overrides.enabledManagers ?? base.enabledManagers,
        ignorePaths: overrides.ignorePaths ?? base.ignorePaths,
        ignoreDependencies:
          base.ignoreDependencies || overrides.ignoreDependencies
            ? [
                ...(base.ignoreDependencies ?? []),
                ...(overrides.ignoreDependencies ?? []),
              ]
            : undefined,
      },
      Predicate.isNotUndefined,
    ),
    managers: {
      ...base.managers,
      ...Record.map(overrides.managers, (manager, name) => ({
        ...base.managers[name],
        ...manager,
        ...Record.filter(
          {
            files:
              base.managers[name]?.files || manager.files
                ? [
                    ...(base.managers[name]?.files ?? []),
                    ...(manager.files ?? []),
                  ]
                : undefined,
          },
          Predicate.isNotUndefined,
        ),
        settings: { ...base.managers[name]?.settings, ...manager.settings },
      })),
    },
    rules: [...base.rules, ...overrides.rules],
    regexManagers: [...base.regexManagers, ...overrides.regexManagers],
    datasources: { ...base.datasources, ...overrides.datasources },
  };
}

const RepositoryPath = Schema.NonEmptyString.check(
  Schema.makeFilter((path) => {
    const normal = normalize(path);

    return !isAbsolute(path) && normal !== ".." && !normal.startsWith("../");
  }),
).annotate({
  description:
    "Repository-relative path. Runtime validation also rejects paths that resolve outside the checkout.",
});

const Command = Schema.Struct({
  argv: Schema.NonEmptyArray(Schema.NonEmptyString),
  cwd: RepositoryPath,
  timeout: Schema.Finite.check(Schema.isGreaterThan(0)),
});

const Diagnostic = Schema.Struct({
  path: Schema.String,
  disposition: Schema.Literals(["blocked", "ignored"]),
  message: Schema.String,
  scope: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        dependencies: Schema.Struct({
          managers: Rule.fields.match.fields.managers,
          datasources: Rule.fields.match.fields.datasources,
          packages: Rule.fields.match.fields.packages,
          dependencies: Rule.fields.match.fields.dependencies,
          files: Rule.fields.match.fields.files,
          dependencyTypes: Rule.fields.match.fields.dependencyTypes,
        }),
      }),
      Schema.Struct({ files: Strings }),
    ]),
  ),
});

/** Versioned, credential-free policy consumed by the native updater. */
export const DependencyConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  policy: Schema.Struct({
    base: DependencyPolicy.annotate({
      description: "Editable policy imported from resolved presets.",
    }),
    overrides: DependencyPolicy.annotate({
      description:
        "Repository overrides replaced by an explicit Renovate re-import.",
    }),
  }),
  validation: Schema.Struct({
    setup: Schema.Array(Command),
    checks: Schema.Array(
      Schema.Struct({
        context: Schema.NonEmptyString,
        appId: Schema.optionalKey(Schema.Int),
        parallel: Schema.optionalKey(Schema.Boolean).annotate({
          description:
            "Allow this check to overlap adjacent parallel checks. Commands within a check remain ordered.",
        }),
        commands: Schema.NonEmptyArray(Command),
      }),
    ),
  }).annotate({
    description:
      "Local setup and checks required before publishing dependency updates.",
  }),
  import: Schema.Struct({
    source: RepositoryPath,
    resolverVersion: Schema.String,
    overrideHash: Schema.String,
    baseDiagnostics: Schema.Array(Diagnostic),
    overrideDiagnostics: Schema.Array(Diagnostic),
  }),
});

/** Decoded native configuration. */
export interface DependencyConfig extends Schema.Schema.Type<
  typeof DependencyConfig
> {}

/** Redacted conversion finding, suitable for a saved report. */
export interface DependencyDiagnostic extends Schema.Schema.Type<
  typeof Diagnostic
> {}

/** Plain JSON object at the Renovate boundary. */
export const RenovateObject = Schema.Record(Schema.String, Schema.Json);

/** Decoded Renovate JSON object. */
export interface RenovateObject extends Schema.Schema.Type<
  typeof RenovateObject
> {}

/** Fields intentionally unused by the on-demand, no-PR workflow. */
export const ignoredRenovateFields = new Set([
  "$schema",
  "description",
  "labels",
  "addLabels",
  "assignees",
  "reviewers",
  "additionalReviewers",
  "schedule",
  "timezone",
  "updateNotScheduled",
  "automerge",
  "automergeType",
  "automergeStrategy",
  "automergeSchedule",
  "platformAutomerge",
  "dependencyDashboard",
  "dependencyDashboardApproval",
  "dependencyDashboardTitle",
  "prConcurrentLimit",
  "prHourlyLimit",
  "branchConcurrentLimit",
  "commitHourlyLimit",
  "prCreation",
  "prNotPendingHours",
  "prPriority",
  "rebaseWhen",
  "branchPrefix",
  "branchTopic",
  "additionalBranchPrefix",
  "commitMessage",
  "commitMessagePrefix",
  "commitMessageSuffix",
  "commitMessageAction",
  "commitMessageTopic",
  "commitMessageExtra",
  "commitBody",
  "semanticCommits",
  "semanticCommitType",
  "semanticCommitScope",
  "prBodyColumns",
  "prBodyDefinitions",
  "prBodyNotes",
  "changelogUrl",
  "stopUpdatingLabel",
]);

/** Remove presentation-only fields without changing meaningful array order. */
export function overrideSnapshot(
  value: Schema.Json,
  options = true,
  root = true,
): Schema.Json {
  if (Array.isArray(value))
    return value.map((entry) => overrideSnapshot(entry, options, false));

  if (!Schema.is(RenovateObject)(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !options ||
          !(
            ignoredRenovateFields.has(key) ||
            (root && (key === "extends" || key === "ignorePresets"))
          ),
      )
      .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
      .map(([key, entry]) => [
        key,
        overrideSnapshot(
          entry,
          options &&
            [
              "packageRules",
              "customManagers",
              "bun",
              "npm",
              "mise",
              "github-actions",
              "git-submodules",
            ].includes(key),
          false,
        ),
      ]),
  );
}

/** Compare explicit overrides by meaning, excluding frozen preset declarations. */
export function overrideHash(source: RenovateObject): string {
  return createHash("sha256")
    .update(JSON.stringify(overrideSnapshot(source)))
    .digest("hex");
}

/** Block a run when the repository's explicit policy needs re-importing. */
export const assertDependencyOverrides = Effect.fn(
  "Dependencies.assertOverrides",
)(function* (config: DependencyConfig, source: RenovateObject) {
  if (config.import.overrideHash !== overrideHash(source)) {
    return yield* new DependencyConfigError({
      message:
        "Renovate overrides changed; run dot deps import-renovate before updating dependencies",
    });
  }
});

/** Pinned discovery evidence used to determine whether imported unsupported policy applies. */
export interface DependencyDiagnosticContext {
  /** Complete native dependency extraction; unknown managers are checked through file scopes. */
  readonly dependencies: readonly Dependency[];
  /** Complete pinned repository file paths, including files outside native managers. */
  readonly files: readonly string[];
}

/** Keep unscoped or possibly applicable findings blocking; missing evidence never excludes them. */
export function blockingDependencyDiagnostics(
  config: DependencyConfig,
  context?: DependencyDiagnosticContext,
): readonly DependencyDiagnostic[] {
  const managers =
    config.policy.overrides.enabledManagers ??
    config.policy.base.enabledManagers;

  const nativeInventory =
    managers !== undefined &&
    managers.length > 0 &&
    managers.every((manager) =>
      [
        "npm",
        "bun",
        "mise",
        "github-actions",
        "git-submodules",
        "custom.regex",
      ].includes(manager),
    );

  return [
    ...config.import.baseDiagnostics,
    ...config.import.overrideDiagnostics,
  ].filter((entry) => {
    if (entry.disposition !== "blocked") return false;

    if (!context || !entry.scope) return true;

    if ("files" in entry.scope) {
      const patterns = entry.scope.files;

      for (const pattern of patterns) matchesPatterns("", [pattern]);

      return context.files.some((file) => matchesPatterns(file, patterns));
    }

    if (!nativeInventory) return true;
    const match = entry.scope.dependencies;

    for (const patterns of Object.values(match))
      for (const pattern of patterns ?? []) matchesPatterns("", [pattern]);

    if (!Object.keys(match).length) return true;

    return context.dependencies.some((dependency) =>
      matchesRule(match, dependency),
    );
  });
}

/** Reject relevant unresolved conversion or missing local validation before publication. */
export const assertDependencyPolicyReady = Effect.fn(
  "Dependencies.assertPolicyReady",
)(function* (config: DependencyConfig, context?: DependencyDiagnosticContext) {
  const blocked = yield* Effect.try({
    try: () => blockingDependencyDiagnostics(config, context),
    catch: () =>
      new DependencyConfigError({
        message: "Invalid imported diagnostic scope",
      }),
  });

  if (blocked.length) {
    return yield* new DependencyConfigError({
      message: `Unresolved dependency policy: ${blocked.map((entry) => entry.path).join(", ")}`,
    });
  }

  if (!config.validation.checks.length) {
    return yield* new DependencyConfigError({
      message: "Configure mapped local checks before publishing updates",
    });
  }
});
