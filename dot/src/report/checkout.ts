import { Duration, Effect } from "effect";
import { join } from "node:path";
import {
  ghRepoCloneCaptured,
  gitHead,
  gitOutput,
  gitRemoteOutput,
  isGitRepo,
} from "../lib/git.js";
import { CACHE_DIR } from "../lib/paths.js";
import { shortSha } from "../lib/pullRequestReviews.js";

/** A shallow clone kept up to date for reports. */
export interface Checkout {
  readonly repository: string;
  readonly branch: string;
  readonly path: string;
  /** Short commit the checkout is at. */
  readonly commit: string;
}

const FETCH_TIMEOUT = Duration.minutes(3);

/** Key shared by sections that read the same repository and branch. */
export const checkoutKey = (repository: string, branch: string) =>
  `${repository}@${branch}`;

/**
 * Bring a shallow clone of `repository` at `branch` up to date, cloning it on
 * first use. dot owns the folder, so a hard reset to the fetched commit is safe.
 */
export const ensureCheckout = Effect.fn("report.checkout")(function* (
  repository: string,
  branch: string,
) {
  const path = join(
    CACHE_DIR,
    "dot",
    "reports",
    "checkouts",
    ...repository.split("/"),
    branch,
  );

  if (yield* isGitRepo(path)) {
    yield* gitRemoteOutput(
      ["fetch", "--depth", "1", "origin", branch],
      { cwd: path },
      FETCH_TIMEOUT,
    );
    yield* gitOutput(["reset", "--quiet", "--hard", "FETCH_HEAD"], {
      cwd: path,
    });
  } else
    yield* ghRepoCloneCaptured(repository, path, [
      "--depth",
      "1",
      "--branch",
      branch,
    ]);

  return {
    repository,
    branch,
    path,
    commit: shortSha(yield* gitHead(path)),
  } satisfies Checkout;
});
