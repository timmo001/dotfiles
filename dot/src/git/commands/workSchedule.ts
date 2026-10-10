import { Effect } from "effect";
import { isWorkTime } from "../../lib/workTime.js";
import { Config } from "../../services/Config.js";
import { managedGitRepoForGitHub } from "../../services/GitConfig.js";

/** Mark tracked repositories on the work activity schedule while outside work time. */
export const markOffSchedule = Effect.fn("markOffSchedule")(function* <
  A extends { readonly repo: string },
>(repositories: readonly A[]) {
  const config = yield* Config;

  const work = (repo: A) =>
    managedGitRepoForGitHub(config.gitConfig, repo.repo)?.activity.schedule ===
    "work";

  const workTimeActive = repositories.some(work)
    ? yield* isWorkTime(() => Effect.void)
    : true;

  return repositories.map((repo) => ({
    ...repo,
    offSchedule: !workTimeActive && work(repo),
  }));
});
