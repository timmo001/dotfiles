import { dirname, join } from "node:path";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Schema,
  Predicate,
  Record,
} from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import {
  DependencyConfig,
  RenovateObject,
  assertDependencyOverrides,
  mergeDependencyPolicy,
  type DependencyPolicy,
} from "./config.js";
import { extractDependencies } from "./extract.js";
import { DependencyGithub, type PullRequestCoverage } from "./github.js";
import { DependencySources } from "./sources.js";
import {
  dependencyGroups,
  dependencySettings,
  requiresSourceUrl,
  selectRelease,
  validateDependencyPatterns,
  type Selection,
} from "./rules.js";
import {
  DependencyDiscoveryError,
  dependencyIdentity,
  type Dependency,
  type Releases,
  type Snapshot,
} from "./model.js";

/** Bounded discovery options shared by previews and isolated update runs. */
export interface DependencyPlanOptions {
  /** Caller directory, used only to select repository and detect override drift. */
  readonly directory: string;
  /** Explicit hosting selector uses only the isolated remote snapshot cache. */
  readonly repository?: string;
  /** Optional remote target branch. */
  readonly target?: string;
  /** Bypass PR inventory and exclusion only. */
  readonly all: boolean;
  /** Per-command/provider deadline in milliseconds. */
  readonly timeout: number;
  /** Maximum concurrent lookups or PR inspections. */
  readonly concurrency: number;
}

/** A preview occurrence with a reason even when it cannot update. */
export interface PlannedDependency {
  /** Immutable source occurrence. */
  readonly dependency: Dependency;
  /** Coordinated group label. */
  readonly group: string;
  /** Version-selection outcome. */
  readonly selection: Selection;
  /** Open PRs covering this group. */
  readonly skippedBy: readonly PullRequestCoverage[];
}

/** Completed read-only plan; blockers never imply publication permission. */
export interface DependencyPlan {
  /** Pinned target identity and source files. */
  readonly snapshot: Snapshot;
  /** Every extracted dependency and its visible outcome. */
  readonly dependencies: readonly PlannedDependency[];
  /** Unresolved import and relevant native policy gaps. */
  readonly blockers: readonly string[];
  /** Relevant failures requiring a non-success CLI exit. */
  readonly failures: readonly string[];
  /** Wall-clock phase durations in milliseconds. */
  readonly timings: Readonly<Record<string, number>>;
  /** Provider requests and in-process deduplication hits. */
  readonly cache: { readonly requests: number; readonly hits: number };
}

/** Read-only authority for rejecting stale caller overrides. */
export interface DependencyLocalPolicyService {
  /** Compare local override meaning with the pinned native baseline. */
  readonly validate: (
    directory: string,
    config: DependencyConfig,
    timeout: number,
  ) => Effect.Effect<void, DependencyDiscoveryError>;
}

/** Caller filesystem boundary for {@link DependencyLocalPolicyService}. */
export class DependencyLocalPolicy extends Context.Service<
  DependencyLocalPolicy,
  DependencyLocalPolicyService
>()("dot/Dependencies/LocalPolicy") {
  /** Read local policy only; never switch branches or update caller refs. */
  static readonly layer = Layer.effect(
    DependencyLocalPolicy,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const executor = yield* CommandExecutor;

      return DependencyLocalPolicy.of({
        validate: Effect.fn("DependencyLocalPolicy.validate")(
          function* (directory, config, timeout) {
            const root = (yield* executor
              .run("git", ["rev-parse", "--show-toplevel"], { cwd: directory })
              .pipe(Effect.timeout(timeout))).trim();

            const source = yield* Schema.decodeEffect(
              Schema.fromJsonString(RenovateObject),
            )(yield* fs.readFileString(join(root, config.import.source)));

            yield* assertDependencyOverrides(config, source);
            const localConfigPath = join(root, "dot-deps.json");

            if (yield* fs.exists(localConfigPath)) {
              const local = yield* Schema.decodeEffect(
                Schema.fromJsonString(DependencyConfig),
              )(yield* fs.readFileString(localConfigPath));

              if (local.import.source !== config.import.source)
                return yield* new DependencyDiscoveryError({
                  message: "Local and target import source paths differ",
                });
              yield* assertDependencyOverrides(local, source);
            }
          },
          Effect.mapError(
            (error) =>
              new DependencyDiscoveryError({
                message: `Local override validation failed: ${error instanceof Error ? error.message : "cannot read policy"}`,
              }),
          ),
        ),
      });
    }),
  );
}

/** Match coverage conservatively, then transitively exclude coordinated groups. */
export function coveredGroups(
  dependencies: readonly Dependency[],
  policy: DependencyPolicy,
  prs: readonly PullRequestCoverage[],
): ReadonlyMap<string, readonly PullRequestCoverage[]> {
  const covered = new Map<string, PullRequestCoverage[]>();

  for (const dependency of dependencies) {
    const matching = prs.filter(
      (pr) =>
        pr.identities.includes(dependencyIdentity(dependency)) ||
        pr.ambiguousFiles.some(
          (file) =>
            file === dependency.file ||
            (/bun\.lockb?$/.test(file) &&
              dirname(file) === dirname(dependency.file)),
        ),
    );

    if (matching.length)
      for (const group of dependencyGroups(policy, dependency))
        covered.set(group, [...(covered.get(group) ?? []), ...matching]);
  }

  let changed = true;

  while (changed) {
    changed = false;

    for (const dependency of dependencies) {
      const groups = dependencyGroups(policy, dependency);
      const prs = groups.flatMap((group) => covered.get(group) ?? []);

      if (!prs.length) continue;

      for (const group of groups)
        if (!covered.has(group)) {
          covered.set(group, prs);
          changed = true;
        }
    }
  }

  return covered;
}

/** Planner authority with explicit repository, metadata and output dependencies. */
export interface DependencyPlannerService {
  /** Discover a read-only grouped plan. */
  readonly plan: (
    options: DependencyPlanOptions,
  ) => Effect.Effect<DependencyPlan, DependencyDiscoveryError>;
}

/** Workflow implementation of {@link DependencyPlannerService}. */
export class DependencyPlanner extends Context.Service<
  DependencyPlanner,
  DependencyPlannerService
>()("dot/Dependencies/Planner") {
  /** Compose pinned extraction, complete PR exclusion and bounded provider reads. */
  static readonly layer = Layer.effect(
    DependencyPlanner,
    Effect.gen(function* () {
      const github = yield* DependencyGithub;
      const local = yield* DependencyLocalPolicy;
      const sources = yield* DependencySources;
      const log = yield* OutputLog;

      return DependencyPlanner.of({
        plan: Effect.fn("DependencyPlanner.plan")(function* (options) {
          const started = yield* Clock.currentTimeMillis;
          yield* log.info("[SNAPSHOT] Resolving remote target");

          const repository = yield* github.resolve(
            options.directory,
            options.repository,
            options.timeout,
          );

          const target = options.target ?? repository.defaultBranchRef?.name;

          if (!repository.url.startsWith("https://github.com/"))
            return yield* new DependencyDiscoveryError({
              message:
                "Native dependency discovery currently requires a github.com repository",
            });

          if (!target)
            return yield* new DependencyDiscoveryError({
              message: "Repository has no remote default branch; pass --target",
            });

          const snapshot = yield* github.snapshot(
            repository.nameWithOwner,
            target,
            options.timeout,
            options.concurrency,
          );

          const config = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(DependencyConfig),
          )(snapshot.files["dot-deps.json"], {
            onExcessProperty: "error",
          }).pipe(
            Effect.mapError(
              () =>
                new DependencyDiscoveryError({
                  message: `Missing or invalid native policy at ${snapshot.sha}`,
                }),
            ),
          );

          const targetSource = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(RenovateObject),
          )(snapshot.files[config.import.source]).pipe(
            Effect.mapError(
              () =>
                new DependencyDiscoveryError({
                  message: `Missing or invalid target overrides at ${snapshot.sha}`,
                }),
            ),
          );

          yield* assertDependencyOverrides(config, targetSource).pipe(
            Effect.mapError(
              (error) =>
                new DependencyDiscoveryError({
                  message: `Target override drift: ${error.message}`,
                }),
            ),
          );

          if (!options.repository)
            yield* local.validate(options.directory, config, options.timeout);

          const policy = mergeDependencyPolicy(
            config.policy.base,
            config.policy.overrides,
          );

          yield* Effect.try({
            try: () => validateDependencyPatterns(policy),
            catch: () =>
              new DependencyDiscoveryError({
                message: "Invalid native dependency matcher",
              }),
          });

          const pinned = yield* Clock.currentTimeMillis;
          yield* log.info(
            `[EXTRACT] ${repository.nameWithOwner}@${snapshot.sha}`,
          );
          const extracted = yield* extractDependencies(snapshot, policy);
          const extractedAt = yield* Clock.currentTimeMillis;
          yield* log.info(
            options.all
              ? "[PRS] --all bypasses inventory and exclusion"
              : "[PRS] Inspecting all open PRs",
          );

          const prs = options.all
            ? []
            : yield* github.inventory(
                snapshot,
                policy,
                options.timeout,
                options.concurrency,
              );

          const inventoried = yield* Clock.currentTimeMillis;

          // Source selectors must be resolved before propagating any PR group coverage.
          const identified = yield* Effect.forEach(
            extracted.dependencies,
            Effect.fn("DependencyPlanner.identifySource")(
              function* (dependency): Effect.fn.Return<{
                dependency: Dependency;
                metadata?: Releases;
                failure?: string;
              }> {
                if (
                  !requiresSourceUrl(policy, dependency) ||
                  dependencySettings(policy, dependency).enabled === false ||
                  dependency.datasource === "local"
                )
                  return { dependency };

                return yield* sources
                  .lookup(dependency, policy, options.timeout)
                  .pipe(
                    Effect.map((metadata) => ({
                      dependency: {
                        ...dependency,
                        ...Record.filter(
                          { sourceUrl: metadata.sourceUrl },
                          Predicate.isNotUndefined,
                        ),
                      },
                      metadata,
                      ...Record.filter(
                        {
                          failure: metadata.sourceUrl
                            ? undefined
                            : "Missing source URL required by ordered policy",
                        },
                        Predicate.isNotUndefined,
                      ),
                    })),
                    Effect.catch((error) =>
                      Effect.succeed({ dependency, failure: error.message }),
                    ),
                  );
              },
            ),
            { concurrency: options.concurrency },
          );

          const coverage = coveredGroups(
            identified.map((entry) => entry.dependency),
            policy,
            prs,
          );

          const blockers = [
            ...config.import.baseDiagnostics,
            ...config.import.overrideDiagnostics,
          ].flatMap((diagnostic) =>
            diagnostic.disposition === "blocked"
              ? [`${diagnostic.path}: ${diagnostic.message}`]
              : [],
          );

          blockers.push(...extracted.blockers);

          if (!config.validation.checks.length)
            blockers.push("Required local check mappings are missing");
          const failures = [...extracted.blockers];
          let completed = 0;

          const dependencies = yield* Effect.forEach(
            identified,
            Effect.fn("DependencyPlanner.lookup")(function* ({
              dependency,
              metadata,
              failure,
            }): Effect.fn.Return<PlannedDependency> {
              const settings = dependencySettings(policy, dependency);

              const group =
                settings.groupSlug ?? settings.groupName ?? dependency.package;

              const skippedBy = [
                ...new Map(
                  dependencyGroups(policy, dependency)
                    .flatMap((group) => coverage.get(group) ?? [])
                    .map((pr) => [pr.number, pr]),
                ).values(),
              ];

              let selection: Selection = {
                settings,
                reason:
                  failure ??
                  (skippedBy.length
                    ? "Covered by an open dependency PR (or ambiguous overlapping change)"
                    : "Disabled or local dependency"),
                blockers: failure ? [failure] : [],
              };

              if (
                !skippedBy.length &&
                !failure &&
                settings.enabled !== false &&
                dependency.datasource !== "local"
              ) {
                selection = yield* (
                  metadata
                    ? Effect.succeed(metadata)
                    : sources.lookup(dependency, policy, options.timeout)
                ).pipe(
                  Effect.flatMap((metadata) => {
                    dependency = {
                      ...dependency,
                      ...Record.filter(
                        { sourceUrl: metadata.sourceUrl },
                        Predicate.isNotUndefined,
                      ),
                    };

                    return Effect.try({
                      try: () =>
                        selectRelease(
                          policy,
                          dependency,
                          metadata,
                          inventoried,
                        ),
                      catch: () =>
                        new DependencyDiscoveryError({
                          message: `${dependency.name}: invalid selector or version expression`,
                        }),
                    });
                  }),
                  Effect.catch((error) =>
                    Effect.succeed({
                      settings,
                      reason: error.message,
                      blockers: [error.message],
                    }),
                  ),
                );
              }

              completed += 1;
              yield* log.info(
                `[LOOKUP ${completed}/${extracted.dependencies.length}] ${dependency.name}: ${selection.reason}`,
              );

              return {
                dependency,
                group:
                  selection.settings.groupSlug ??
                  selection.settings.groupName ??
                  group,
                selection,
                skippedBy,
              };
            }),
            { concurrency: options.concurrency },
          );

          const finalCoverage = coveredGroups(
            dependencies.map((entry) => entry.dependency),
            policy,
            prs,
          );

          const finalDependencies = dependencies.map(
            (entry): PlannedDependency => {
              const covered = finalCoverage.get(entry.group) ?? entry.skippedBy;

              const skippedBy = [
                ...new Map(covered.map((pr) => [pr.number, pr])).values(),
              ];

              const settings = entry.selection.settings;

              const separation =
                settings.separateMajorMinor !== false &&
                entry.selection.updateType === "major"
                  ? ":major"
                  : settings.separateMinorPatch &&
                      entry.selection.updateType === "patch"
                    ? ":patch"
                    : "";

              return {
                ...entry,
                group: `${entry.group}${separation}`,
                skippedBy,
                selection:
                  skippedBy.length && !entry.selection.blockers.length
                    ? {
                        settings,
                        reason:
                          "Covered by an open dependency PR (or ambiguous overlapping change)",
                        blockers: [],
                      }
                    : entry.selection,
              };
            },
          );

          for (const entry of finalDependencies) {
            blockers.push(
              ...entry.selection.blockers.map(
                (blocker) =>
                  `${entry.dependency.file}: ${entry.dependency.name}: ${blocker}`,
              ),
            );
            failures.push(
              ...entry.selection.blockers.map(
                (blocker) => `${entry.dependency.name}: ${blocker}`,
              ),
            );
          }

          const finished = yield* Clock.currentTimeMillis;

          return {
            snapshot,
            dependencies: finalDependencies,
            blockers: [...new Set(blockers)],
            failures: [...new Set(failures)],
            timings: {
              snapshot: pinned - started,
              extraction: extractedAt - pinned,
              prs: inventoried - extractedAt,
              lookup: finished - inventoried,
              total: finished - started,
            },
            cache: yield* sources.stats(),
          };
        }),
      });
    }),
  );
}
