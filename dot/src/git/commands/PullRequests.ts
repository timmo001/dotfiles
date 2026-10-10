import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import {
  GitPullRequests,
  type PullRequestQuery,
} from "../services/GitPullRequests.js";
import { handleCommandError, writeText } from "./rows.js";
import { markOffSchedule } from "./workSchedule.js";

/** Open the tracked PR page. */
export const pullRequestsOpenShell = Effect.fn("pullRequests.openShell")(
  function* (repo: string | undefined) {
    const executor = yield* CommandExecutor;
    yield* executor.run("omarchy-shell", [
      "shell",
      "summon",
      "timmo.git",
      JSON.stringify({ view: "pulls", repo }),
    ]);
    yield* executor.run("omarchy-shell", ["timmo.git", "pulls", repo ?? ""]);
  },
  handleCommandError("dot pr list"),
);

/** Read tracked PRs, returning JSON for the Git panel. */
export const pullRequestsQuery = Effect.fn("pullRequests.query")(function* (
  options: PullRequestQuery,
  panelJson: boolean,
) {
  const service = yield* GitPullRequests;

  const repositories = yield* service
    .query(options)
    .pipe(Effect.flatMap(markOffSchedule));

  yield* writeText(
    panelJson
      ? JSON.stringify({ repositories }) + "\n"
      : repositories
          .map((repo) =>
            [
              `${repo.name}: ${repo.checkedAt === null ? "Pull requests unavailable" : `${repo.pulls.length} open pull requests${repo.error ? " (stale)" : ""}`}`,
              ...(repo.error ? [`  ${repo.error}`] : []),
              ...repo.pulls.map(
                (pr) => `  #${pr.number} ${pr.title}\n  ${pr.url}`,
              ),
            ].join("\n"),
          )
          .join("\n\n") + "\n",
  );
  // The CLI exits explicitly, so wait for the complete snapshot to drain.
  yield* Effect.promise(
    () =>
      new Promise<void>((resolve) => process.stdout.write("", () => resolve())),
  );
}, handleCommandError("dot pr list"));
