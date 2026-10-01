import { createHash, randomUUID } from "node:crypto";
import { acquireFileLock } from "../lib/fileLock.js";
import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { CONFIG_DIR, STATE_DIR } from "../lib/paths.js";

/** An execution failure whose worktree and evidence must be retained. */
export class DependencyRunError extends Schema.TaggedError<DependencyRunError>()(
  "DependencyRunError",
  {
    message: Schema.String,
    transientNetwork: Schema.optionalKey(Schema.Boolean),
  },
) {}

/** A completed dependency run with one or more unsuccessful update groups. */
export class DependencyRunWarning extends Schema.TaggedError<DependencyRunWarning>()(
  "DependencyRunWarning",
  { message: Schema.String },
) {}

/** Explicit host permissions, stored outside repository-controlled policy. */
export const DependencyTrust = Schema.Struct({
  trusted: Schema.Boolean,
  allowBypass: Schema.Boolean,
});

/** Read host permissions without allowing a repository to grant itself trust. */
export const readDependencyTrust = Effect.fn("Dependencies.readTrust")(
  function* (repository: string) {
    const fs = yield* FileSystem.FileSystem;
    const file = join(CONFIG_DIR, "dot", "dependencies.yml");

    if (!(yield* fs.exists(file)))
      return yield* new DependencyRunError({
        message: `Configure ${repository} host trust in ${file} before running dependency updates`,
      });

    const entries = yield* fs.readFileString(file).pipe(
      Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Record(Schema.String, DependencyTrust),
        ),
      ),
    );

    const trust = entries[repository];

    if (!trust?.trusted)
      return yield* new DependencyRunError({
        message: `${repository} is not trusted for host execution`,
      });

    return trust;
  },
);

/** Stable repository/target state and a unique retained run directory. */
export function dependencyRunPaths(repository: string, target: string) {
  const root = join(
    STATE_DIR,
    "dot",
    "dependencies",
    createHash("sha256").update(`${repository}\0${target}`).digest("hex"),
  );

  return {
    root,
    repository: join(root, "repository.git"),
    run: join(root, "runs", randomUUID()),
  };
}

/** Hold an inherited kernel lock for the whole integration scope, including interruption. */
export const lockDependencyTarget = Effect.fn("Dependencies.lockTarget")(
  function* (root: string) {
    yield* acquireFileLock(join(root, "integration.lock")).pipe(
      Effect.mapError(
        (error) =>
          new DependencyRunError({
            message:
              error.reason === "busy"
                ? `Another dependency run owns ${root}`
                : "Cannot acquire dependency integration lock",
          }),
      ),
    );
  },
);
