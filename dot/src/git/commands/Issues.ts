import { Effect } from "effect";
import { GitIssues, type IssueQuery } from "../services/GitIssues.js";
import { handleCommandError } from "./rows.js";
import { markOffSchedule } from "./workSchedule.js";

/** Tracked issues for every enabled repository, as `--panel-json` prints them. */
export const issuesValue = Effect.fn("issues.value")(function* (
  options: IssueQuery,
) {
  const service = yield* GitIssues;

  const repositories = yield* service
    .query(options)
    .pipe(Effect.flatMap(markOffSchedule));

  return { repositories };
});

/** Read tracked issues, returning JSON for the Git panel. */
export const issuesQuery = Effect.fn("issues.query")(function* (
  options: IssueQuery,
  panelJson: boolean,
) {
  const { repositories } = yield* issuesValue(options);

  const text = panelJson
    ? JSON.stringify({ repositories }) + "\n"
    : repositories
        .map((repo) =>
          [
            `${repo.name}: ${repo.checkedAt === null ? "Issues unavailable" : `${repo.issues.length} open issues${repo.error ? " (stale)" : ""}`}`,
            ...(repo.error ? [`  ${repo.error}`] : []),
            ...repo.issues.map(
              (issue) => `  #${issue.number} ${issue.title}\n  ${issue.url}`,
            ),
          ].join("\n"),
        )
        .join("\n\n") + "\n";

  // The CLI exits explicitly, so wait until the whole snapshot is flushed.
  yield* Effect.promise(
    () =>
      new Promise<void>((resolve) =>
        process.stdout.write(text, () => resolve()),
      ),
  );
}, handleCommandError("dot git issues"));
