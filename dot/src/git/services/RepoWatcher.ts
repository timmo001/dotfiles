import {
  Clock,
  Context,
  Effect,
  Layer,
  PubSub,
  Schedule,
  Stream,
} from "effect";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Repo, RepoState } from "../../types.js";
import { DotDiff } from "./DotDiff.js";

const log = (msg: string) => console.error(`[dot:Watcher] ${msg}`);

/** Service interface for the hybrid repo-polling watcher */
interface RepoWatcherService {
  /** Subscribe to a stream of repo state snapshots */
  readonly subscribe: () => Stream.Stream<RepoState>;
  /** Trigger an immediate poll refresh */
  readonly refresh: () => Effect.Effect<void>;
  /** Return the most recently polled state */
  readonly getState: () => Effect.Effect<RepoState>;
}

/** Effect service for {@link RepoWatcherService} */
export class RepoWatcher extends Context.Service<
  RepoWatcher,
  RepoWatcherService
>()("RepoWatcher") {
  static readonly layer = Layer.effect(
    RepoWatcher,
    Effect.gen(function* () {
      log("Initialising RepoWatcher...");
      const dotDiff = yield* DotDiff;
      const pubsub = yield* PubSub.unbounded<RepoState>();

      let currentState: RepoState = {
        changed: [],
        unchanged: [],
        lastChecked: new Date(yield* Clock.currentTimeMillis),
      };

      // Full poll: runs dot git-diff for both lists
      const poll = Effect.gen(function* () {
        log("Polling dot git-diff...");
        const [all, changed] = yield* Effect.all(
          [dotDiff.listAll(), dotDiff.listChanged()],
          { concurrency: 2 },
        );

        const now = yield* Clock.currentTimeMillis;
        const state = buildRepoState(all, changed, new Date(now));
        currentState = state;
        yield* PubSub.publish(pubsub, state);
        log(
          `Poll complete: ${changed.length} changed, ${state.unchanged.length} unchanged`,
        );
      }).pipe(
        Effect.withSpan("RepoWatcher.poll"),
        Effect.catch(() => {
          log("Poll failed");
          return Effect.void;
        }),
      );

      // Fast first paint: run a full poll before the background fiber starts
      yield* poll;
      log("Initial load complete");

      // Start background poll fiber (10s interval, matching lazygit)
      yield* poll.pipe(
        Effect.repeat(Schedule.spaced("10 seconds")),
        Effect.forkScoped,
      );
      log("Background poll started (10s interval)");

      return {
        subscribe: () => Stream.fromPubSub(pubsub),
        refresh: () => poll,
        getState: () => Effect.succeed(currentState),
      };
    }),
  );
}

/** Check for `.git/index.lock` and enrich a repo with lock status */
function withLockStatus(repo: Repo): Repo {
  const lockPath = join(repo.path, ".git", "index.lock");
  return { ...repo, locked: existsSync(lockPath) };
}

function buildRepoState(
  all: readonly Repo[],
  changed: readonly Repo[],
  lastChecked: Date,
): RepoState {
  const changedPaths = new Set(changed.map((r) => r.path));
  const enrichedChanged = changed.map(withLockStatus);
  const unchanged = all
    .filter((r) => !changedPaths.has(r.path))
    .map(withLockStatus);
  return { changed: enrichedChanged, unchanged, lastChecked };
}
