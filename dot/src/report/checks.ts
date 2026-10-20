import { Effect, FileSystem } from "effect";
import { join } from "node:path";
import { pathExists } from "../lib/fsProbe.js";
import type { Checkout } from "./checkout.js";
import type { ChecksSection } from "./config.js";
import type { ChecksResult, CheckState } from "./result.js";

/**
 * Test each check's pattern against its file. A finding is `active` while the
 * outcome matches `expect`, `resolved` once it doesn't, and `missing` when the
 * file is gone.
 */
export const runChecksSection = Effect.fn("report.checks")(function* (
  section: ChecksSection,
  checkout: Checkout,
) {
  const fs = yield* FileSystem.FileSystem;

  const checks = yield* Effect.forEach(section.checks, (check) =>
    Effect.gen(function* () {
      const path = join(checkout.path, check.file);

      const state: CheckState = (yield* pathExists(path))
        ? new RegExp(check.pattern, "m").test(
            yield* fs.readFileString(path),
          ) ===
          (check.expect === "match")
          ? "active"
          : "resolved"
        : "missing";

      return {
        title: check.title,
        file: check.file,
        finding: check.finding,
        state,
        verdict: check.verdict,
        tone: check.tone,
      };
    }),
  );

  return { type: "checks", section, checkout, checks } satisfies ChecksResult;
});
