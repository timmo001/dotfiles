import { Effect, Layer } from "effect";
import {
  DependencyImporter,
  type ImportRenovateOptions,
} from "../deps/importRenovate.js";
import { RenovateResolver } from "../deps/renovateResolver.js";
import { OutputLog } from "../services/OutputLog.js";
import { FetchHttpClient } from "effect/unstable/http";
import { DependencyDiskCache } from "../deps/cache.js";
import { DependencyGithub } from "../deps/github.js";
import { DependencySources } from "../deps/sources.js";
import {
  DependencyLocalPolicy,
  DependencyPlanner,
  type DependencyPlanOptions,
} from "../deps/plan.js";
import { DependencyDiscoveryError } from "../deps/model.js";

const github = DependencyGithub.layer.pipe(
  Layer.provide(DependencyDiskCache.layer),
);

const sources = DependencySources.layer.pipe(
  Layer.provide([github, DependencyDiskCache.layer, FetchHttpClient.layer]),
);

const planner = DependencyPlanner.layer.pipe(
  Layer.provide([github, sources, DependencyLocalPolicy.layer]),
);

/** Print a native read-only plan; publication remains explicitly unavailable. */
export const previewDependencies = Effect.fn("Dependencies.preview")(function* (
  options: DependencyPlanOptions & { readonly dryRun: boolean },
) {
  if (!options.dryRun)
    return yield* new DependencyDiscoveryError({
      message:
        "Dependency publication is not available until Stage 3. Use dot deps --dry-run to preview native updates.",
    });
  const planner = yield* DependencyPlanner;
  const log = yield* OutputLog;
  yield* log.section("Native Dependency Preview");
  const result = yield* planner.plan(options);

  if (result.snapshot.directory)
    yield* log.info(`Isolated source checkout: ${result.snapshot.directory}`);
  const groups = [...new Set(result.dependencies.map((entry) => entry.group))];

  for (const group of groups) {
    yield* log.info(`[GROUP] ${group}`);

    for (const entry of result.dependencies.filter(
      (entry) => entry.group === group,
    )) {
      const next = entry.selection.release;
      yield* log.info(
        `  ${entry.dependency.file}: ${entry.dependency.name} ${entry.dependency.current}${entry.dependency.digest ? `@${entry.dependency.digest.slice(0, 12)}` : ""}${next ? ` -> ${entry.selection.candidate ?? next.version}${next.digest ? `@${next.digest.slice(0, 12)}` : ""}` : ""}: ${entry.selection.reason}`,
      );

      for (const pr of entry.skippedBy)
        yield* log.info(`    [SKIP] PR #${pr.number} ${pr.url}, ${pr.checks}`);
    }
  }

  for (const blocker of result.blockers)
    yield* log.warn(`[BLOCKED] ${blocker}`);
  yield* log.info(
    `Pinned ${result.snapshot.repository}@${result.snapshot.sha}; ${result.dependencies.filter((entry) => entry.selection.release && !entry.skippedBy.length).length} candidate occurrences, ${result.dependencies.filter((entry) => entry.skippedBy.length).length} PR-skipped, ${result.failures.length} discovery failures`,
  );
  yield* log.info(
    `Timings: ${Object.entries(result.timings)
      .map(([phase, millis]) => `${phase}=${millis}ms`)
      .join(
        ", ",
      )}; ${result.cache.requests} provider lookups, ${result.cache.hits} cache hits`,
  );

  if (result.failures.length)
    return yield* new DependencyDiscoveryError({
      message: `Preview incomplete: ${result.failures.length} relevant discovery failures (reported above)`,
    });
}, Effect.provide(planner));

/** Convert repository policy through the import service and report saved blockers. */
export const importRenovate = Effect.fn("Dependencies.importRenovate")(
  function* (options: ImportRenovateOptions) {
    const importer = yield* DependencyImporter;
    const log = yield* OutputLog;
    yield* log.section("Import Renovate Policy");
    const result = yield* importer.import(options);

    const findings = [
      ...result.config.import.baseDiagnostics,
      ...result.config.import.overrideDiagnostics,
    ];

    const blocked = findings.filter(
      (finding) => finding.disposition === "blocked",
    );

    yield* log.info(`Wrote ${result.path}`);
    yield* log.info(
      `Imported ${result.config.policy.base.rules.length + result.config.policy.overrides.rules.length} rules; ${blocked.length} unresolved settings`,
    );
    yield* log.info(
      "The conversion report is saved in import.baseDiagnostics and import.overrideDiagnostics",
    );
    yield* Effect.forEach(
      result.config.import.overrideDiagnostics,
      (finding) =>
        log.info(
          `[${finding.disposition === "blocked" ? "BLOCKED" : "IGNORED"}] ${finding.path}: ${finding.message}`,
        ),
      { discard: true },
    );

    if (blocked.length)
      yield* log.warn(
        "Publication remains blocked by unresolved policy; inspect the saved conversion report",
      );

    if (!result.config.validation.checks.length)
      yield* log.warn(
        "Configure required local check mappings before publishing updates",
      );
  },
  Effect.provide(
    DependencyImporter.layer.pipe(Layer.provide(RenovateResolver.layer)),
  ),
);
