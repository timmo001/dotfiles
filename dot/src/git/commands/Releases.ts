import { Effect, Result } from "effect";
import { Prompt } from "effect/unstable/cli";
import { decodeJson } from "../../lib/schema.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { OutputLog } from "../../services/OutputLog.js";
import { ReleaseError } from "../release/types.js";
import type { ReleasePublishAction } from "../release/publish.js";
import { recoverRelease } from "../release/recover.js";
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
            `  ${snapshot.releaseTag} -> ${snapshot.branch}: ${snapshot.complete && !entry.stale ? snapshot.suggestion : `incomplete (provisional ${snapshot.suggestion})`}${snapshot.reviewed ? " (reviewed)" : ""}`,
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

/** Offer the saved release log in the current terminal. */
const viewReleaseLog = Effect.fn("releases.viewLog")(function* (path: string) {
  const open = yield* Prompt.run(
    Prompt.confirm({ message: "Read the full progress log?", initial: false }),
  ).pipe(Effect.catchTag("QuitError", () => Effect.succeed(false)));

  if (!open) return;
  const executor = yield* CommandExecutor;
  // Let NodeTerminal release its raw input reader before the pager takes over.
  yield* Effect.sleep("20 millis");
  yield* executor.inherit("less", ["-R", "--", path]);
});

/** Explain a release before confirmation and stream confirmed execution progress. */
export const releasesPublish = Effect.fn("releases.publish")(function* (
  action: ReleasePublishAction,
  panelJson: boolean,
  interactive = false,
) {
  if (
    interactive &&
    (panelJson ||
      action.confirm !== undefined ||
      !process.stdin.isTTY ||
      !process.stdout.isTTY)
  )
    return yield* new ReleaseError({
      message:
        "--interactive requires a terminal and cannot be combined with --confirm or --panel-json",
    });
  const releases = yield* GitReleases;
  const output: string[] = [];
  const log = yield* OutputLog;

  const progress = (message: string) =>
    Effect.sync(() => {
      output.push(message);

      if (output.length > 120) output.shift();
    }).pipe(
      Effect.andThen(
        panelJson
          ? writeJsonLine(decodeJson({ type: "progress", message }))
          : interactive
            ? log.info(message)
            : writeText(message + "\n"),
      ),
    );

  const inspect = releases.publish(action, progress);

  const preview = yield* (
    interactive ? log.withSpinner("Checking release", inspect) : inspect
  ).pipe(Effect.result);

  if (Result.isFailure(preview)) {
    if (!interactive) return yield* preview.failure;
    yield* recoverRelease(action, preview.failure, output);
    process.exitCode = 1;
    yield* flushOutput;

    return;
  }

  let result = preview.success;
  const plan = result.type === "plan" ? result.plan : null;

  if (panelJson) yield* writeJsonLine(decodeJson(result));
  else if (result.type === "plan")
    yield* writeText(
      [
        `Create ${result.plan.tag} in ${result.plan.repo}`,
        ...result.plan.steps.map((step, index) => `${index + 1}. ${step}`),
        "",
        ...(interactive
          ? []
          : [
              "Confirm these steps with:",
              `dot git-releases publish --repo ${JSON.stringify(action.repo)} --snapshot ${action.snapshot} --confirm ${result.plan.id}`,
            ]),
        "",
      ].join("\n"),
    );

  if (interactive && result.type === "plan") {
    const confirmed = yield* Prompt.run(
      Prompt.confirm({
        message: `Create and publish ${result.plan.tag} with these steps?`,
        initial: false,
      }),
    ).pipe(Effect.catchTag("QuitError", () => Effect.succeed(false)));

    if (!confirmed) {
      yield* writeText("Release cancelled.\n");
      yield* flushOutput;

      return;
    }

    const outcome = yield* log
      .withSpinner(
        `Creating release ${result.plan.tag}`,
        releases.publish({ ...action, confirm: result.plan.id }, progress),
      )
      .pipe(Effect.result);

    if (Result.isFailure(outcome)) {
      yield* recoverRelease(
        action,
        outcome.failure,
        output,
        result.plan.logPath,
      );
      process.exitCode = 1;
      yield* flushOutput;

      return;
    }

    result = outcome.success;
  }

  if (result.type === "created" && !panelJson) {
    if (interactive) {
      yield* log.section("Release Summary");

      if (plan) {
        for (const file of plan.versions)
          yield* log.info(`${file.path}: ${file.before} -> ${file.after}`);
        yield* log.info(
          `Validation: ${plan.commands.length ? plan.commands.map((command) => command.join(" ")).join("; ") : "GitHub build/package workflows"}`,
        );
        yield* log.info(`Target: ${plan.repo}:${plan.branch}`);
        yield* log.info(
          plan.versions.some((file) => file.before !== file.after)
            ? "Version commit and tag pushed"
            : "Tag created at the reviewed commit",
        );
        yield* log.info(
          `Release notes: generated by GitHub since ${plan.previousTag}`,
        );
      }

      yield* log.info(`Released commit: ${result.target}`);
    }

    yield* writeText(
      `Created ${result.tag}: ${result.url}\nPublication jobs: ${result.actionsUrl}\nFull log: ${result.logPath}\n`,
    );

    if (interactive) yield* viewReleaseLog(result.logPath);
  }

  yield* flushOutput;
}, handleCommandError("dot git-releases publish"));

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

/** Apply a snapshot-bound local impact review and return the new display. */
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
