import { Effect } from "effect";
import { decodeJson } from "../../lib/schema.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { ReleaseError } from "../release/types.js";
import {
  GitReleases,
  type ReleaseAction,
  type ReleaseEntry,
  type ReleaseQuery,
} from "../services/GitReleases.js";
import { handleCommandError, writeJsonLine, writeText } from "./rows.js";

// The CLI exits explicitly; large review snapshots must drain their pipe first.
const flushOutput = Effect.callback<void, ReleaseError>((resume) => {
  const onError = (error: Error) =>
    resume(Effect.fail(new ReleaseError({ message: error.message })));
  process.stdout.once("error", onError);
  process.stdout.end(() => resume(Effect.void));
  return Effect.sync(() => process.stdout.off("error", onError));
});

function summary(entries: readonly ReleaseEntry[]): string {
  if (!entries.length) return "No release repositories enabled.\n";
  return (
    entries
      .map((entry) => {
        const snapshot = entry.snapshot;
        const lines = [`${entry.name} (${entry.repo})`];
        if (!snapshot)
          lines.push(`  ${entry.error ?? "Not checked yet; use --refresh"}`);
        else {
          lines.push(
            `  ${snapshot.releaseTag} -> ${snapshot.branch}: ${snapshot.complete && !entry.stale ? snapshot.suggestion : `incomplete (provisional ${snapshot.suggestion})`}${snapshot.reviewed ? " (reviewed)" : ""}${entry.acknowledged ? " (acknowledged)" : ""}`,
          );
          lines.push(
            `  ${snapshot.commits.length} commits; ${snapshot.findings.filter((fact) => fact.impact !== "none").length} release-relevant and ${snapshot.findings.filter((fact) => fact.impact === "none").length} quiet findings`,
          );
          lines.push(
            `  Checked: ${snapshot.checkedAt}`,
            `  Snapshot: ${snapshot.id}`,
            `  ${snapshot.url}`,
          );
          for (const fact of snapshot.findings)
            lines.push(
              `  [${fact.impact}${fact.complete ? "" : ", incomplete"}] ${fact.detail}: ${fact.reason}${fact.reviewed ? " (local review)" : ""}`,
            );
          for (const error of snapshot.errors)
            lines.push(`  Missing evidence: ${error}`);
          if (entry.error) lines.push(`  Stale: ${entry.error}`);
        }
        if (entry.deliveryError) lines.push(`  ${entry.deliveryError}`);
        return lines.join("\n");
      })
      .join("\n\n") + "\n"
  );
}

/** Open the release review view without scanning or sending notifications. */
export const releasesOpenShell = Effect.fn("releases.openShell")(function* (
  repo: string | undefined,
) {
  const executor = yield* CommandExecutor;
  yield* executor.run("omarchy-shell", [
    "shell",
    "summon",
    "timmo.git",
    JSON.stringify({ view: "releases", repo }),
  ]);
  // Installed shells discard summon payloads for bar-widget panels.
  yield* executor.run("omarchy-shell", ["timmo.git", "release", repo ?? ""]);
}, handleCommandError("dot git-releases"));

/** Show cached or refreshed comparisons, with explicit opt-in desktop delivery. */
export const releasesQuery = Effect.fn("releases.query")(function* (
  options: ReleaseQuery,
  panelJson: boolean,
) {
  const releases = yield* GitReleases;
  const repositories = yield* releases.query(options);
  yield* panelJson
    ? writeJsonLine(decodeJson({ repositories }))
    : writeText(summary(repositories));
  yield* flushOutput;
}, handleCommandError("dot git-releases"));

/** Apply a snapshot-bound local review or acknowledgement and return the new display. */
export const releasesAction = Effect.fn("releases.action")(function* (
  action: ReleaseAction,
  panelJson: boolean,
) {
  const releases = yield* GitReleases;
  const repository = yield* releases.action(action);
  yield* panelJson
    ? writeJsonLine(decodeJson({ repositories: [repository] }))
    : writeText(summary([repository]));
  yield* flushOutput;
}, handleCommandError("dot git-releases"));
