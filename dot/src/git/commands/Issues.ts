import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { GitIssues, type IssueQuery } from "../services/GitIssues.js";
import { handleCommandError } from "./rows.js";

/** Open the tracked issue page. */
export const issuesOpenShell = Effect.fn("issues.openShell")(function* (
  repo: string | undefined,
) {
  const executor = yield* CommandExecutor;
  yield* executor.run("omarchy-shell", [
    "shell",
    "summon",
    "timmo.git",
    JSON.stringify({ view: "issues", repo }),
  ]);
  yield* executor.run("omarchy-shell", ["timmo.git", "issues", repo ?? ""]);
}, handleCommandError("dot git issues"));

/** Read tracked issues, returning JSON for the Git panel. */
export const issuesQuery = Effect.fn("issues.query")(function* (
  options: IssueQuery,
  panelJson: boolean,
) {
  const service = yield* GitIssues;
  const repositories = yield* service.query(options);

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
