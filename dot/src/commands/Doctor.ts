import { Effect, FileSystem, Option } from "effect";
import { join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { runDoctor } from "../doctor/runner.js";
import { withSpinnerTimeout } from "../lib/workflowStep.js";
import { displayPath } from "../lib/paths.js";
import { ENV, envString } from "../lib/env.js";
import { cliStyler } from "../lib/ansi.js";
import { logFields, plural } from "../lib/runSummary.js";
import type { CheckSection, DoctorReport } from "../doctor/types.js";

/** Whole-run backstop for the doctor command. Individual checks are shorter. */
const DOCTOR_RUN_TIMEOUT_SECONDS = 60;

function timedOutDoctorReport(): DoctorReport {
  return {
    sections: [
      {
        name: "Doctor run",
        results: [
          {
            severity: "error",
            message: `Doctor timed out after ${DOCTOR_RUN_TIMEOUT_SECONDS}s`,
          },
        ],
      },
    ],
    warnings: 0,
    errors: 1,
    timestamp: Date.now(),
  };
}

/** Format a doctor report as plain text for file output */
function formatReport(report: DoctorReport): string {
  const lines: string[] = [];
  const ts = new Date(report.timestamp).toISOString();
  lines.push(`dot doctor report \u2014 ${ts}`);
  lines.push("");

  for (const section of report.sections) {
    lines.push(`\u2500\u2500 ${section.name}`);

    for (const r of section.results) {
      const label = r.severity === "ok" ? "INFO" : r.severity.toUpperCase();
      lines.push(`  [${label.padEnd(5)}] ${r.message}`);

      if (r.detail) lines.push(`           ${r.detail}`);
    }

    lines.push("");
  }

  lines.push(`${report.warnings} warning(s), ${report.errors} error(s)`);

  return lines.join("\n");
}

/**
 * Run all doctor checks and display structured results.
 *
 * Matches legacy output density: section headings per category,
 * per-item status lines, grouped summary at end.
 */
export const doctor = Effect.gen(function* () {
  const config = yield* Config;
  const fs = yield* FileSystem.FileSystem;
  const log = yield* OutputLog;
  const style = cliStyler();

  // Header summary (matches legacy), printed before checks start streaming
  const header: Array<readonly [string, string]> = [
    ["Public repo", displayPath(config.publicDotfiles)],
  ];

  if (config.privateDotfiles)
    header.push(["Private repo", displayPath(config.privateDotfiles)]);

  if (config.notesDir)
    header.push(["Notes repo", displayPath(config.notesDir)]);

  header.push(["Private mode", envString(ENV.DOT_ALLOW_PRIVATE) ?? "auto"]);

  yield* logFields(header.map(([label, value]) => [label, style.dim(value)]));

  // Track in-flight checks so the spinner shows what is still running. Checks
  // run in parallel, so this starts as every check and shrinks to the slow
  // ones (typically the network checks) as the fast ones finish.
  const running = new Set<string>();

  const runningLabel = (): string => {
    if (running.size === 0) return "Running health checks";
    const names = [...running];
    const shown = names.slice(0, 3).join(", ");
    const more = names.length > 3 ? ` +${names.length - 3} more` : "";

    return `Running health checks (${running.size}): ${shown}${more}`;
  };

  // Seed the spinner with every check as they all start at once.
  const onStart = (names: readonly string[]) =>
    Effect.gen(function* () {
      for (const name of names) running.add(name);
      yield* log.updateSpinner(runningLabel());
    });

  // Retire a finished check from the spinner, then stream its heading and
  // result lines. Streamed live as each check completes (completion order);
  // the ordered summary follows below.
  const renderSection = (section: CheckSection) =>
    Effect.gen(function* () {
      running.delete(section.name);
      yield* log.updateSpinner(runningLabel());
      yield* log.section(section.name);

      for (const result of section.results) {
        switch (result.severity) {
          case "ok":
            yield* log.success(result.message);
            break;
          case "warn":
            yield* log.warn(result.message);
            break;
          case "error":
            yield* log.error(result.message);
            break;
        }

        if (result.detail) {
          yield* log.info(`  ${style.dim(result.detail)}`);
        }
      }
    });

  // Run checks in parallel behind a single spinner that shows the checks
  // still running, streaming each section's detail as it finishes.
  const reportResult = yield* withSpinnerTimeout(
    "Running health checks",
    DOCTOR_RUN_TIMEOUT_SECONDS,
    runDoctor(renderSection, onStart),
  );

  const report = Option.getOrElse(reportResult, timedOutDoctorReport);

  // Grouped summary: errors by section, then warnings by section
  if (report.errors > 0) {
    yield* log.section("Collected Errors");

    for (const section of report.sections) {
      const errors = section.results.filter((r) => r.severity === "error");

      if (errors.length === 0) continue;
      yield* log.info(style.label(section.name));

      for (const r of errors) {
        yield* log.error(`  ${r.message}`);

        if (r.detail) {
          yield* log.info(`    ${style.dim(r.detail)}`);
        }
      }
    }
  }

  if (report.warnings > 0) {
    yield* log.section("Collected Warnings");

    for (const section of report.sections) {
      const warns = section.results.filter((r) => r.severity === "warn");

      if (warns.length === 0) continue;
      yield* log.info(style.label(section.name));

      for (const r of warns) {
        yield* log.warn(`  ${r.message}`);
      }
    }
  }

  // Write report to file
  const reportPath = join(config.logDir, `doctor-${report.timestamp}.log`);
  yield* fs
    .writeFileString(reportPath, formatReport(report))
    .pipe(Effect.orDie);

  // Final summary
  const passed = report.sections.reduce(
    (sum, section) =>
      sum + section.results.filter((r) => r.severity === "ok").length,
    0,
  );

  yield* log.section("Summary");
  yield* log.info(
    [
      style.success(`${passed} passed`),
      report.warnings > 0
        ? style.warn(plural(report.warnings, "warning"))
        : style.dim("0 warnings"),
      report.errors > 0
        ? style.error(plural(report.errors, "critical issue"))
        : style.dim("0 critical issues"),
    ].join(style.dim(" · ")),
  );

  if (report.errors === 0 && report.warnings === 0) {
    yield* log.success("No issues found");
  } else if (report.errors === 0) {
    yield* log.warn("No critical issues");
  } else {
    yield* log.error("Critical issues found");
  }

  yield* log.info(style.dim(`Report: ${displayPath(reportPath)}`));

  // Exit with error status if critical issues found
  if (report.errors > 0) {
    yield* Effect.sync(() => {
      process.exitCode = 1;
    });
  }
});
