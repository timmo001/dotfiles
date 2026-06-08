import { Effect } from "effect";
import { writeFileSync } from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher } from "../services/Launcher.js";
import { runDoctor } from "../doctor/runner.js";
import { displayPath } from "../lib/paths.js";
import type { DoctorReport } from "../doctor/types.js";

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
export const doctor = (opts?: { readonly openOpencode?: boolean }) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const launcher = yield* Launcher;

    const report = yield* runDoctor;

    // Header summary (matches legacy)
    yield* log.info(`Public repo: ${displayPath(config.publicDotfiles)}`);
    if (config.privateDotfiles) {
      yield* log.info(`Private repo: ${displayPath(config.privateDotfiles)}`);
    }
    if (config.notesDir) {
      yield* log.info(`Notes repo: ${displayPath(config.notesDir)}`);
    }
    yield* log.info(`Private mode: ${process.env.DOT_ALLOW_PRIVATE ?? "auto"}`);

    // Stream results section by section
    for (const section of report.sections) {
      yield* log.section(section.name);
      for (const result of section.results) {
        switch (result.severity) {
          case "ok":
            yield* log.info(result.message);
            break;
          case "warn":
            yield* log.warn(result.message);
            break;
          case "error":
            yield* log.error(result.message);
            break;
        }
        if (result.detail) {
          yield* log.info(`  ${result.detail}`);
        }
      }
    }

    // Grouped summary: errors by section, then warnings by section
    if (report.errors > 0) {
      yield* log.section("Collected Errors");
      for (const section of report.sections) {
        const errors = section.results.filter((r) => r.severity === "error");
        if (errors.length === 0) continue;
        yield* log.info(`  ${section.name}`);
        for (const r of errors) {
          yield* log.error(`    ${r.message}`);
          if (r.detail) {
            yield* log.info(`      ${r.detail}`);
          }
        }
      }
    }

    if (report.warnings > 0) {
      yield* log.section("Collected Warnings");
      for (const section of report.sections) {
        const warns = section.results.filter((r) => r.severity === "warn");
        if (warns.length === 0) continue;
        yield* log.info(`  ${section.name}`);
        for (const r of warns) {
          yield* log.warn(`    ${r.message}`);
        }
      }
    }

    // Final summary line
    if (report.errors === 0 && report.warnings === 0) {
      yield* log.info("Doctor finished: no critical issues found");
    } else if (report.errors === 0) {
      yield* log.warn(
        `Doctor finished: no critical issues, ${report.warnings} warning(s)`,
      );
    } else {
      yield* log.error(
        `Doctor finished: ${report.errors} critical issue(s), ${report.warnings} warning(s)`,
      );
    }

    // Write report to file
    const reportPath = join(config.logDir, `doctor-${report.timestamp}.log`);
    writeFileSync(reportPath, formatReport(report));

    // --open-opencode: hand off to opencode for analysis
    if (opts?.openOpencode) {
      yield* log.info(`Saved doctor report: ${reportPath}`);

      const opencodePrompt = `Review the dot doctor report at ${reportPath}. Read it with the Read tool first. Give a concise diagnosis of any issues or warnings, probable causes, and a prioritized action plan to resolve them.`;

      yield* launcher
        .suspend(`opencode --prompt ${JSON.stringify(opencodePrompt)}`)
        .pipe(Effect.catch(() => Effect.void));
    }

    // Exit with error status if critical issues found
    if (report.errors > 0) {
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
    }
  });
