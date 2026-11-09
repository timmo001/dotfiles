/**
 * @file The dot daemon's view of the Git panel: repository state, GitHub
 * notifications, pull requests, issues and the commit log, read every minute
 * and on request. Each part is published as soon as it is read, so a slow
 * GitHub query doesn't hold back the rest.
 */

import {
  Cause,
  Context,
  Effect,
  Layer,
  Schema,
  Semaphore,
  SubscriptionRef,
} from "effect";
import { diffBarValue, diffPanelValue } from "../git/commands/Diff.js";
import { issuesValue } from "../git/commands/Issues.js";
import { queryGitLog } from "../git/commands/Log.js";
import { notificationsBarValue } from "../git/commands/Notifications.js";
import { pullRequestsValue } from "../git/commands/PullRequests.js";
import { formatCommandError } from "../git/commands/rows.js";
import type { GitSection, GitSnapshot } from "./Rpcs.js";

const decodeJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown),
);

const make = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make<GitSnapshot>({});
  const lock = yield* Semaphore.make(1);

  const read = (force: boolean) => {
    // A part that fails keeps its error, as its command would print it.
    const section = <A, E, R>(
      key: keyof GitSnapshot,
      effect: Effect.Effect<A, E, R>,
    ) =>
      effect.pipe(
        // Optional fields left undefined aren't JSON, so each part is sent as
        // the JSON its command prints.
        Effect.flatMap((value) => decodeJson(JSON.stringify(value))),
        Effect.map((value): GitSection => ({ value })),
        Effect.catchCause((cause) =>
          Effect.succeed<GitSection>({
            error: formatCommandError(Cause.squash(cause)),
          }),
        ),
        Effect.flatMap((part) =>
          SubscriptionRef.update(ref, (snapshot) => ({
            ...snapshot,
            [key]: part,
          })),
        ),
      );

    return Effect.all(
      [
        // The panel's full list follows the bar's quicker scan, as before.
        section("diff", diffBarValue()).pipe(
          Effect.andThen(section("panel", diffPanelValue())),
        ),
        section("notifications", notificationsBarValue()),
        section("pullRequests", pullRequestsValue({ refresh: force })),
        section("issues", issuesValue({ refresh: force })),
        section(
          "log",
          queryGitLog(force).pipe(
            Effect.map((repositories) => ({ repositories })),
          ),
        ),
      ],
      { concurrency: "unbounded", discard: true },
    );
  };

  const services =
    yield* Effect.context<Effect.Services<ReturnType<typeof read>>>();

  const refresh = Effect.fn("GitStore.refresh")(
    function* (force: boolean) {
      yield* read(force);

      return yield* SubscriptionRef.get(ref);
    },
    Semaphore.withPermit(lock),
    Effect.provideContext(services),
  );

  yield* refresh(false).pipe(
    Effect.andThen(Effect.sleep("1 minute")),
    Effect.forever,
    Effect.forkScoped,
  );

  return {
    /** The Git panel's state, then each change. */
    changes: SubscriptionRef.changes(ref),
    /** Read every part now; `force` skips the PR, issue and log caches. */
    refresh,
  };
});

/** The Git panel's state, its changes, and a way to read it again. */
export type GitStoreService = Effect.Success<typeof make>;

/** The daemon's Git panel state; see {@link GitStoreService}. */
export class GitStore extends Context.Service<GitStore, GitStoreService>()(
  "dot/daemon/GitStore",
) {
  /** Reads the Git panel now and every minute. */
  static readonly layer = Layer.effect(GitStore, make);
}
