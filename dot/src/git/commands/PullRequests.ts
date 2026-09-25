import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import {
  GitPullRequests,
  type PullRequestQuery,
} from "../services/GitPullRequests.js";
import { handleCommandError, writeText } from "./rows.js";

/** Open the tracked PR page without changing its local seen state. */
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
  handleCommandError("dot git-pull-requests"),
);

/** Read tracked PRs or acknowledge a PR, returning JSON for the Git panel. */
export const pullRequestsQuery = Effect.fn("pullRequests.query")(function* (
  options: PullRequestQuery,
  panelJson: boolean,
) {
  const service = yield* GitPullRequests;
  const repositories = yield* service.query(options);
  yield* writeText(
    panelJson
      ? JSON.stringify({ repositories }) + "\n"
      : repositories
          .map((repo) =>
            [
              `${repo.name}: ${repo.checkedAt === null ? "Pull requests unavailable" : `${repo.pulls.length} open pull requests${repo.error ? " (stale)" : ""}`}`,
              ...(repo.error ? [`  ${repo.error}`] : []),
              ...(repo.deliveryError ? [`  ${repo.deliveryError}`] : []),
              ...repo.pulls.map(
                (pr) =>
                  `  ${pr.seen ? "" : "[new] "}#${pr.number} ${pr.title}\n  ${pr.url}`,
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
}, handleCommandError("dot git-pull-requests"));
