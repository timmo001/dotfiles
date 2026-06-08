import { Effect, Schema } from "effect";
import { existsSync } from "fs";
import { Config } from "../services/Config.js";
import { managedGitRepos } from "../services/GitConfig.js";
import { OutputLog } from "../services/OutputLog.js";
import { ghRepoClone } from "./git.js";
import { displayPath } from "./paths.js";

/** Domain error for private git repository bootstrap failures. */
export class GitConfigRepoError extends Schema.TaggedErrorClass<GitConfigRepoError>()(
  "GitConfigRepoError",
  {
    message: Schema.String,
  },
) {}

function fail(message: string): Effect.Effect<never, GitConfigRepoError> {
  return Effect.fail(new GitConfigRepoError({ message }));
}

/** Clone configured private git repositories that are missing locally. */
export function cloneMissingGitConfigRepos(opts?: {
  readonly strict?: boolean;
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
      const cloneError = yield* ghRepoClone(repo.github, repo.path).pipe(
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
