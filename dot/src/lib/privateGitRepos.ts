import { Effect, Schema } from "effect";
import { existsSync } from "fs";
import { Config } from "../services/Config.js";
import { managedGitRepos } from "../services/GitConfig.js";
import { OutputLog } from "../services/OutputLog.js";
import { ghRepoClone, ghRepoCloneCaptured } from "./git.js";

/** Domain error for private git repository bootstrap failures. */
export class GitConfigRepoError extends Schema.TaggedError<GitConfigRepoError>()(
  "GitConfigRepoError",
  {
    message: Schema.String,
  },
) {}

function fail(message: string): Effect.Effect<never, GitConfigRepoError> {
  return Effect.fail(new GitConfigRepoError({ message }));
}

/**
 * Clone configured private git repositories that are missing locally.
 *
 * Set `captured` to clone through {@link ghRepoCloneCaptured} under a per-repo
 * spinner (used by `dot init`); leave it unset for the default inherited-stdio
 * clone that streams git/gh progress (used by `dot update`).
 */
export function cloneMissingGitConfigRepos(opts?: {
  readonly strict?: boolean;
  readonly captured?: boolean;
}) {
  return Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;

    if (!config.canUsePrivate) {
      yield* log.warn(
        `Skipping private git repo clones (${config.privateReason})`,
      );
      return;
    }

    if (!config.gitConfig.valid) {
      const message = config.gitConfig.diagnostics.join("; ");
      if (opts?.strict) return yield* fail(message);
      yield* log.warn(message);
      return;
    }

    const missing = managedGitRepos(config.gitConfig).filter(
      (repo) => !existsSync(repo.path),
    );
    if (missing.length === 0) return;

    yield* log.section("Clone Private Git Repositories");
    for (const repo of missing) {
      yield* log.info(`Cloning ${repo.name} (${repo.github})`);
      const clone = opts?.captured
        ? log.withSpinner(
            `Cloning ${repo.name}`,
            ghRepoCloneCaptured(repo.github, repo.path),
          )
        : ghRepoClone(repo.github, repo.path);
      const cloneError = yield* clone.pipe(
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
