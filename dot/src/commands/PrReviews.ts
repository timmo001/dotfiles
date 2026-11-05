import { Repository } from "@timmo001/effect-gh";
import { Effect, Schema } from "effect";
import {
  fetchBranchReviews,
  fetchReviews,
  GH_OPTIONS,
  ghErrorMessage,
  isOpenThread,
  type PullRequestRef,
  pullRequestLookupMessage,
  renderReviews,
  resolvePullRequest,
  type ReviewState,
} from "../lib/pullRequestReviews.js";

/** Options for {@link prReviews}. */
export interface PrReviewsOptions {
  /** Pull request numbers; empty means the current branch's pull request. */
  readonly prs: readonly number[];
  /** Repository slug passed to gh when the pull requests are not in the current repository. */
  readonly repo: string | undefined;
  /** Branch whose open pull request to read, found in the same query as its reviews. */
  readonly branch: string | undefined;
  /** Print the decoded review state as JSON instead of Markdown. */
  readonly json: boolean;
}

class PrReviewsError extends Schema.TaggedError<PrReviewsError>()(
  "PrReviewsError",
  { message: Schema.String },
) {}

const branchReviews = Effect.fn("branchReviews")(function* (
  branch: string,
  repo: string | undefined,
) {
  const slug =
    repo ??
    (yield* Repository.view(undefined, GH_OPTIONS).pipe(
      Effect.mapError(
        (error) =>
          new PrReviewsError({
            message: `Could not resolve the repository: ${ghErrorMessage(error)}`,
          }),
      ),
    )).nameWithOwner;
  const [owner, name] = slug.split("/").slice(-2);

  if (!owner || !name)
    return yield* new PrReviewsError({
      message: `Unrecognised repository: ${slug}`,
    });

  const found = yield* fetchBranchReviews({ owner, name }, branch).pipe(
    Effect.mapError(
      (error) =>
        new PrReviewsError({
          message: `Could not fetch reviews for ${branch}: ${ghErrorMessage(error)}`,
        }),
    ),
  );

  return found ? [found] : [];
});

const run = Effect.fn("prReviews")(function* (options: PrReviewsOptions) {
  if (options.branch !== undefined && options.prs.length > 0)
    return yield* new PrReviewsError({
      message: "--branch can't be combined with pull request numbers",
    });

  const pullRequests: readonly {
    readonly pr: PullRequestRef;
    readonly state: ReviewState;
  }[] =
    options.branch === undefined
      ? yield* Effect.forEach(
          options.prs.length > 0 ? options.prs : [undefined],
          (selector) =>
            resolvePullRequest(selector, options.repo).pipe(
              Effect.mapError(
                (error) =>
                  new PrReviewsError({
                    message: pullRequestLookupMessage(error),
                  }),
              ),
              Effect.flatMap((pr) =>
                fetchReviews(pr).pipe(
                  Effect.mapError(
                    (error) =>
                      new PrReviewsError({
                        message: `Could not fetch reviews for #${pr.number}: ${ghErrorMessage(error)}`,
                      }),
                  ),
                  Effect.map((state) => ({ pr, state })),
                ),
              ),
            ),
          { concurrency: 4 },
        )
      : yield* branchReviews(options.branch, options.repo);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        pullRequests: pullRequests.map(({ pr, state }) => ({
          ...pr,
          openThreads: state.threads.filter(isOpenThread).length,
          ...state,
        })),
      })}\n`,
    );

    return;
  }

  if (pullRequests.length === 0) {
    process.stdout.write(`No open pull request for ${options.branch}.\n`);

    return;
  }

  process.stdout.write(
    `${pullRequests.map(({ pr, state }) => renderReviews(pr, state)).join("\n")}\n`,
  );
});

/** Print the current reviews and review threads of pull requests once. */
export const prReviews = (options: PrReviewsOptions) =>
  run(options).pipe(
    Effect.catchTag("PrReviewsError", (error) =>
      Effect.sync(() => {
        console.error(`pr reviews: ${error.message}`);
        process.exitCode = 1;
      }),
    ),
  );
