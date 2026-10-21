import { Console, Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { ENV, envString, setEnv, unsetEnv } from "../lib/env.js";
import { HOME_DIR } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";

/** Path of the optional compose config; `dot compose up` needs it. */
export const COMPOSE_CONFIG = join(HOME_DIR, ".config", "dot", "compose.yml");

const ComposeConfig = Schema.Struct({
  directory: Schema.String,
  envFile: Schema.optional(Schema.String),
  pruneAfterHours: Schema.optional(Schema.Finite),
});

/** The compose config is missing or invalid. */
export class ComposeError extends Schema.TaggedError<ComposeError>()(
  "ComposeError",
  { message: Schema.String },
) {}

const expandHome = (path: string) => path.replace(/^~(?=\/|$)/, HOME_DIR);

const loadConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(COMPOSE_CONFIG)))
    return yield* new ComposeError({
      message: `${COMPOSE_CONFIG} does not exist`,
    });

  return yield* fs.readFileString(COMPOSE_CONFIG).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(ComposeConfig)),
    Effect.mapError(
      (error) =>
        new ComposeError({ message: `${COMPOSE_CONFIG}: ${String(error)}` }),
    ),
  );
}).pipe(Effect.withSpan("Compose.loadConfig"));

/** Variables a bash `source` of the file would export, as compose-up saw them. */
const sourcedEnvironment = Effect.fn("Compose.sourcedEnvironment")(function* (
  file: string,
) {
  const executor = yield* CommandExecutor;

  const output = yield* executor
    .run("bash", ["-c", '. "$1" && env -0', "dot-compose", file])
    .pipe(
      Effect.mapError(
        (error) =>
          new ComposeError({
            message: `Failed to load ${file}: ${error.message}`,
          }),
      ),
    );

  return Object.fromEntries(
    output.split("\0").flatMap((entry) => {
      const index = entry.indexOf("=");

      return index > 0 ? [[entry.slice(0, index), entry.slice(index + 1)]] : [];
    }),
  );
});

/**
 * Copy child process output into the log file for the rest of the scope,
 * restoring the previous settings afterwards.
 */
const teeChildOutput = (logFile: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = {
        file: envString(ENV.DOT_LOG_FILE),
        tee: envString(ENV.DOT_TEE_INHERIT_LOG),
      };

      setEnv(ENV.DOT_LOG_FILE, logFile);
      setEnv(ENV.DOT_TEE_INHERIT_LOG, "1");

      return previous;
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous.file === undefined) unsetEnv(ENV.DOT_LOG_FILE);
        else setEnv(ENV.DOT_LOG_FILE, previous.file);

        if (previous.tee === undefined) unsetEnv(ENV.DOT_TEE_INHERIT_LOG);
        else setEnv(ENV.DOT_TEE_INHERIT_LOG, previous.tee);
      }),
  );

/**
 * Pull and start each compose file, then prune unused Docker data. Runs every
 * `*.yml` in the configured directory, or only the given files. A failed file
 * does not stop the rest. Its messages and Docker's output also go to the
 * run's dot log. Returns the exit code of the first failure, or 0.
 */
export const composeUp = Effect.fn("Compose.up")(function* (
  files: readonly string[],
) {
  const config = yield* loadConfig;
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;
  const output = yield* OutputLog;
  const directory = expandHome(config.directory);

  yield* output.section("Compose Up");
  yield* teeChildOutput(output.logFile);

  const env =
    config.envFile === undefined
      ? {}
      : yield* sourcedEnvironment(expandHome(config.envFile));

  const targets =
    files.length > 0
      ? files
      : (yield* fs.readDirectory(directory))
          .filter((name) => name.endsWith(".yml"))
          .sort()
          .map((name) => join(directory, name));

  let failed = 0;

  for (const file of targets) {
    yield* output.info(file);

    const pulled = yield* executor.inherit(
      "docker",
      ["compose", "--file", file, "pull"],
      { env },
    );

    const exitCode =
      pulled === 0
        ? yield* executor.inherit(
            "docker",
            ["compose", "--file", file, "up", "-d", "--remove-orphans"],
            { env },
          )
        : pulled;

    if (exitCode !== 0) {
      yield* output.error(`${file} failed (exit ${exitCode})`);
      failed ||= exitCode;
    }
  }

  const hours = config.pruneAfterHours ?? 30 * 24;

  yield* output.info(`Pruning unused Docker data over ${hours}h old`);

  const pruned = yield* executor.inherit(
    "docker",
    ["system", "prune", "-af", "--filter", `until=${hours}h`],
    { env },
  );

  yield* output.info(`Log: ${output.logFile}`);

  return failed || pruned;
}, Effect.scoped);

/** Run {@link composeUp} as a command, reporting failures and the exit code. */
export const composeUpCommand = (files: readonly string[]) =>
  composeUp(files).pipe(
    Effect.catchTag("ComposeError", (error) =>
      Console.error(`[ERROR] ${error.message}`).pipe(Effect.as(1)),
    ),
    Effect.orDie,
    Effect.flatMap((exitCode) =>
      Effect.sync(() => {
        if (exitCode !== 0) process.exitCode = exitCode;

        console.log(
          `[RESULT] Compose up ${exitCode === 0 ? "succeeded" : `failed (exit ${exitCode})`}`,
        );
      }),
    ),
  );
