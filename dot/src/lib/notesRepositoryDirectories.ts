import { Cause, Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { loadTracked } from "../commands/Repos.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { writeFileAtomic } from "./atomicWrite.js";
import { STATE_DIR } from "./paths.js";
import { plural } from "./runSummary.js";
import { done, skip, warn } from "./updateSummary.js";

/** Notes' map of repository slugs to local checkout directories. */
const NOTES_REPOSITORY_DIRECTORIES_FILE = join(
  STATE_DIR,
  "notes",
  "repository-directories.json",
);

const RepositoryDirectories = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.String),
);

/**
 * Add tracked GitHub checkouts missing from Notes' repository directory map.
 * Existing entries are kept, so paths Notes resolved itself always win.
 * Returns an update recap entry and never fails.
 */
export const syncNotesRepositoryDirectories = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;
  const fs = yield* FileSystem.FileSystem;

  if (!config.canUsePrivate || !config.gitConfig.present) {
    return skip("Notes repository directories skipped (no private config)");
  }

  const tracked = yield* loadTracked;

  const exists = yield* fs
    .exists(NOTES_REPOSITORY_DIRECTORIES_FILE)
    .pipe(Effect.orElseSucceed(() => false));

  const current = exists
    ? yield* fs
        .readFileString(NOTES_REPOSITORY_DIRECTORIES_FILE)
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(RepositoryDirectories)))
    : {};

  const missing = Object.fromEntries(
    tracked.flatMap((repo) =>
      repo.github !== null && repo.exists && !(repo.github in current)
        ? [[repo.github, repo.path] as const]
        : [],
    ),
  );

  const added = Object.keys(missing).length;

  if (added === 0) {
    return skip("Notes repository directories already up to date");
  }

  yield* Effect.try(() =>
    writeFileAtomic(
      NOTES_REPOSITORY_DIRECTORIES_FILE,
      `${JSON.stringify({ ...missing, ...current }, null, 2)}\n`,
      { mode: 0o600, createDirectory: true },
    ),
  );

  yield* log.info(
    `Added ${plural(added, "repository", "repositories")} to Notes repository directories`,
  );

  return done(
    `Added ${plural(added, "repository", "repositories")} to Notes repository directories`,
  );
}).pipe(
  Effect.catchCause((cause) =>
    Effect.gen(function* () {
      const log = yield* OutputLog;
      yield* log.warn(
        `Notes repository directories sync failed: ${String(Cause.squash(cause))}`,
      );

      return warn("Notes repository directories sync failed");
    }),
  ),
  Effect.withSpan("update.syncNotesRepositoryDirectories"),
);
