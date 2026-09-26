import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
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
    const file = join(CONFIG_DIR, "dot", "dependencies.json");

    if (!(yield* fs.exists(file)))
      return yield* new DependencyRunError({
        message: `Configure ${repository} host trust in ${file} before running dependency updates`,
      });

    const entries = yield* Schema.decodeEffect(
      Schema.fromJsonString(Schema.Record(Schema.String, DependencyTrust)),
    )(yield* fs.readFileString(file));

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
    const fd = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          mkdirSync(root, { recursive: true, mode: 0o700 });

          return openSync(join(root, "integration.lock"), "a+", 0o600);
        },
        catch: () =>
          new DependencyRunError({
            message: "Cannot open dependency integration lock",
          }),
      }),
      (descriptor) => Effect.sync(() => closeSync(descriptor)),
    );

    const locked = yield* Effect.try({
      try: () =>
        Bun.spawnSync(["flock", "--exclusive", "--nonblock", "0"], {
          stdin: fd,
          stdout: "ignore",
          stderr: "pipe",
        }).exitCode === 0,
      catch: () =>
        new DependencyRunError({
          message: "Cannot acquire dependency integration lock",
        }),
    });

    if (!locked)
      return yield* new DependencyRunError({
        message: `Another dependency run owns ${root}`,
      });
  },
);
