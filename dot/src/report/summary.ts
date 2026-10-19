import { Effect } from "effect";
import { opencodeText, withoutDashes } from "../lib/opencodeText.js";
import type { ReportConfig } from "./config.js";
import { changeLines, headline, type ReportRun } from "./render.js";

/**
 * Ask the report's summary models, in order, for a short "what changed"
 * paragraph from this run's numbers. Returns `undefined` when the report has
 * no summary models, it's the first run, or none of them answer.
 */
export const summarise = Effect.fn("report.summarise")(function* (
  config: ReportConfig,
  run: Omit<ReportRun, "summary">,
  cwd: string,
) {
  if (!config.summary || !run.changes) return undefined;

  const facts = {
    report: config.title,
    now: headline({ ...run, summary: undefined }),
    changes: run.results.map((result) => ({
      section: result.section.title,
      lines: changeLines(result, run.changes).map((line) => ({
        text: line.text,
        items: line.items.map((item) => item.text),
      })),
    })),
  };

  const prompt = [
    "You're writing the opening paragraph of a weekly report. Don't use any tools.",
    `The report's numbers and what changed since the last run:\n${JSON.stringify(facts, null, 2)}`,
    "Items listed as no longer matched by a search only dropped out of that search, for example because its date range moved on; don't describe them as merged, closed or changed.",
    "In three sentences at most, say what changed since the last run, using only these facts. If nothing changed, say so in one sentence. Use UK English and no dashes. Reply with the paragraph only.",
  ].join("\n\n");

  for (const model of config.summary.models) {
    const text = yield* opencodeText({
      model,
      prompt,
      title: `${config.title} summary`,
      cwd,
      timeout: config.summary.timeout,
    });

    if (text) return { text: withoutDashes(text), model };
  }

  return undefined;
});
