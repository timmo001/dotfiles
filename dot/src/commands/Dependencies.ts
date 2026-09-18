import { Effect, Layer } from "effect";
import {
  DependencyImporter,
  type ImportRenovateOptions,
} from "../deps/importRenovate.js";
import { RenovateResolver } from "../deps/renovateResolver.js";
import { OutputLog } from "../services/OutputLog.js";

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
