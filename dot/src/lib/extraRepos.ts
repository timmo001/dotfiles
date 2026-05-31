import { Effect, Schema } from "effect";
import { existsSync } from "fs";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { ghRepoClone } from "./git.js";
import { displayPath } from "./omarchyHost.js";

/** Domain error for extra repository bootstrap failures. */
export class ExtraRepoError extends Schema.TaggedErrorClass<ExtraRepoError>()(
  "ExtraRepoError",
  {
    message: Schema.String,
  },
) {}

function fail(message: string): Effect.Effect<never, ExtraRepoError> {
  return Effect.fail(new ExtraRepoError({ message }));
}

/** Clone configured extra repositories that are missing locally. */
export function cloneMissingExtraRepos(opts?: { readonly strict?: boolean }) {
  return Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;

    if (!config.canUsePrivate) {
      yield* log.warn(`Skipping extra repo clones (${config.privateReason})`);
      return;
    }

    const missing = config.extraRepos.filter((repo) => !existsSync(repo.path));
    if (missing.length === 0) return;

    yield* log.section("Clone Extra Repositories");
    for (const repo of missing) {
      if (!repo.remote) {
        const message = `Missing extra repo remote for ${repo.name}: ${displayPath(repo.path)}`;
        if (opts?.strict) return yield* fail(message);
        yield* log.warn(message);
        continue;
      }

      yield* log.info(`Cloning ${repo.name} (${repo.remote})`);
      const cloneError = yield* ghRepoClone(repo.remote, repo.path).pipe(
        Effect.map(() => null),
        Effect.catchTag("GitCommandError", (error) =>
          Effect.succeed(error.message),
        ),
      );
      if (cloneError) {
        if (opts?.strict) return yield* fail(cloneError);
        yield* log.warn(cloneError);
      }
    }
  });
}
