/**
 * @file The Git panel's state from the dot daemon: follow it, or ask the
 * daemon to read it again.
 */

import { Cause, Console, Effect, Stream } from "effect";
import { DaemonClient } from "../../daemon/Client.js";
import { formatCause } from "../../lib/schema.js";

const reportLost = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    yield* Console.error(
      Cause.hasInterruptsOnly(cause)
        ? "[ERROR] dot daemon stopped"
        : `[ERROR] dot daemon unreachable: ${formatCause(Cause.squash(cause))}`,
    );
    process.exitCode = 1;
  });

/**
 * Print the Git panel's state from the dot daemon as JSON, then again after
 * each part changes. Exits 1 when the daemon can't be reached or the
 * connection ends, so a supervisor can restart it.
 */
export const gitWatch = Effect.gen(function* () {
  const client = yield* DaemonClient;

  yield* client.WatchGit().pipe(
    Stream.map((snapshot) => JSON.stringify(snapshot)),
    Stream.changes,
    Stream.runForEach((line) => Console.log(line)),
  );

  yield* reportLost(Cause.interrupt());
}).pipe(
  Effect.provide(DaemonClient.layer),
  Effect.catchCause(reportLost),
  Effect.withSpan("gitWatch"),
);

/**
 * Ask the dot daemon to read the Git panel's state again, so its watchers
 * see the result. `force` skips the PR, issue and commit log caches.
 */
export const gitRefresh = Effect.fn("gitRefresh")(
  function* (force: boolean) {
    const client = yield* DaemonClient;

    yield* client.RefreshGit({ force });
  },
  Effect.provide(DaemonClient.layer),
  Effect.catchCause(reportLost),
);
