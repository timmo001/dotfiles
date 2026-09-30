import { Effect, Schema } from "effect";
import {
  fetchReviews,
  ghErrorMessage,
  isOpenThread,
  pullRequestLookupMessage,
  renderReviews,
  resolvePullRequest,
} from "../lib/pullRequestReviews.js";

/** Options for {@link prReviews}. */
export interface PrReviewsOptions {
  /** Pull request numbers; empty means the current branch's pull request. */
  readonly prs: readonly number[];
  /** Repository slug passed to gh when the pull requests are not in the current repository. */
  readonly repo: string | undefined;
  /** Print the decoded review state as JSON instead of Markdown. */
  readonly json: boolean;
}

class PrReviewsError extends Schema.TaggedError<PrReviewsError>()(
  "PrReviewsError",
  { message: Schema.String },
) {}

const run = Effect.fn("prReviews")(function* (options: PrReviewsOptions) {
  const pullRequests = yield* Effect.forEach(
    options.prs.length > 0 ? options.prs : [undefined],
    (selector) =>
      resolvePullRequest(selector, options.repo).pipe(
        Effect.mapError(
          (error) =>
            new PrReviewsError({ message: pullRequestLookupMessage(error) }),
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
  );

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
