import { Cause, Effect, FileSystem, Schema } from "effect";
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
    .run("bash", ["-c", '. "$1"; env -0', "dot-compose", file])
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
 * does not stop the rest. Each step, any error and Docker's output go to the
 * run's dot log. Returns the exit code of the first failure, or 0.
 */
export const composeUp = Effect.fn("Compose.up")(function* (
  files: readonly string[],
) {
  const output = yield* OutputLog;

  yield* output.section("Compose Up");
  yield* teeChildOutput(output.logFile);

  const exitCode = yield* composeSteps(files).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);

      return output
        .error(
          error instanceof ComposeError ? error.message : Cause.pretty(cause),
        )
        .pipe(Effect.as(1));
    }),
  );

  if (exitCode === 0) yield* output.success("Compose up succeeded");
  else yield* output.error(`Compose up failed (exit ${exitCode})`);

  yield* output.info(`Log: ${output.logFile}`);

  return exitCode;
}, Effect.scoped);

const composeSteps = Effect.fn("Compose.steps")(function* (
  files: readonly string[],
) {
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;
  const output = yield* OutputLog;

  yield* output.info(`Config: ${COMPOSE_CONFIG}`);

  const config = yield* loadConfig;
  const directory = expandHome(config.directory);
  const hours = config.pruneAfterHours ?? 30 * 24;

  yield* output.info(`Directory: ${directory}`);
  yield* output.info(`Prune after: ${hours}h`);

  let env: Record<string, string> = {};

  if (config.envFile === undefined) yield* output.info("Env file: none");
  else {
    const envFile = expandHome(config.envFile);

    yield* output.info(`Loading env file ${envFile}`);
    env = yield* sourcedEnvironment(envFile);
    yield* output.success(
      `Loaded env file (${Object.keys(env).length} variables)`,
    );
  }

  const targets =
    files.length > 0
      ? files
      : (yield* fs.readDirectory(directory))
          .filter((name) => name.endsWith(".yml"))
          .sort()
          .map((name) => join(directory, name));

  yield* output.info(
    `Found ${targets.length} compose file${targets.length === 1 ? "" : "s"}`,
  );

  for (const file of targets) yield* output.info(`  ${file}`);

  const failures: string[] = [];
  let failed = 0;

  for (const [index, file] of targets.entries()) {
    const label = `[${index + 1}/${targets.length}] ${file}`;

    yield* output.section(label);

    let exitCode = 0;

    for (const [step, args] of [
      ["Pull", ["compose", "--file", file, "pull"]],
      ["Up", ["compose", "--file", file, "up", "-d", "--remove-orphans"]],
    ] as const) {
      yield* output.info(`${step}: docker ${args.join(" ")}`);
      exitCode = yield* executor.inherit("docker", args, { env });

      if (exitCode !== 0) {
        yield* output.error(`${step} failed (exit ${exitCode})`);
        break;
      }

      yield* output.success(`${step} done`);
    }

    if (exitCode === 0) yield* output.success(`${label} is up`);
    else {
      yield* output.error(`${label} failed (exit ${exitCode})`);
      failures.push(file);
      failed ||= exitCode;
    }
  }

  yield* output.section("Docker Prune");

  const pruneArgs = ["system", "prune", "-af", "--filter", `until=${hours}h`];

  yield* output.info(`docker ${pruneArgs.join(" ")}`);

  const pruned = yield* executor.inherit("docker", pruneArgs, { env });

  if (pruned === 0) yield* output.success("Prune done");
  else yield* output.error(`Prune failed (exit ${pruned})`);

  yield* output.section("Compose Summary");
  yield* output.info(
    `${targets.length - failures.length} of ${targets.length} compose files up`,
  );

  for (const file of failures) yield* output.error(`Failed: ${file}`);

  return failed || pruned;
});

/** Run {@link composeUp} as a command, setting the exit code on failure. */
export const composeUpCommand = (files: readonly string[]) =>
  composeUp(files).pipe(
    Effect.flatMap((exitCode) =>
      Effect.sync(() => {
        if (exitCode !== 0) process.exitCode = exitCode;
      }),
    ),
  );
