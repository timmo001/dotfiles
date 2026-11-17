import { Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { writeFileAtomic } from "../lib/atomicWrite.js";
import { displayPath } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import type { GitManagedRepo } from "../services/GitConfig.js";
import { OutputLog } from "../services/OutputLog.js";

const NOTES_REPOSITORY = "timmo001/notes";

// The ignored env file the capture Alchemy stack and its github stack read
const CAPTURE_ENV_PATH = join("capture", ".env.prod");

const CAPTURE_REPOSITORIES_KEY = "CAPTURE_REPOSITORIES";

const CAPTURE_REPOSITORY_PRIORITY = [
  "Dotfiles",
  "Skills",
  "Notes",
  "Context",
  "Workflows",
];

/** Repository picker record consumed by the notes capture application. */
export interface CaptureRepositoryOption {
  /** Friendly repository label. */
  readonly label: string;
  /** Normalised GitHub owner/repository identifier. */
  readonly repository: string;
}

class NotesCaptureSyncError extends Schema.TaggedError<NotesCaptureSyncError>()(
  "NotesCaptureSyncError",
  { message: Schema.String },
) {}

/** Build picker options with core tooling first, then private config order. */
export function captureRepositoryOptions(
  repositories: readonly GitManagedRepo[],
): readonly CaptureRepositoryOption[] {
  const enabled = repositories.flatMap((repository) =>
    repository.notifications.enabled && repository.github
      ? [{ ...repository, github: repository.github }]
      : [],
  );

  return [
    ...CAPTURE_REPOSITORY_PRIORITY.flatMap((name) =>
      enabled.filter((repository) => repository.name === name),
    ),
    ...enabled.filter(
      ({ name }) => !CAPTURE_REPOSITORY_PRIORITY.includes(name),
    ),
  ].map(({ name, github }) => ({ label: name, repository: github }));
}

/** Set CAPTURE_REPOSITORIES in dotenv source, keeping every other line. */
export function setCaptureRepositories(
  source: string,
  repositories: readonly CaptureRepositoryOption[],
): string {
  const value = JSON.stringify(repositories);

  // Single quotes keep the JSON literal: dotenv parsers don't unescape inside them
  if (value.includes("'")) {
    throw new Error("Repository labels can't contain a single quote");
  }

  const line = `${CAPTURE_REPOSITORIES_KEY}='${value}'`;

  const pattern = new RegExp(
    `^\\s*(?:export\\s+)?${CAPTURE_REPOSITORIES_KEY}\\s*=.*$`,
    "m",
  );

  if (pattern.test(source)) {
    return source.replace(pattern, () => line);
  }

  return `${source}${source === "" || source.endsWith("\n") ? "" : "\n"}${line}\n`;
}

/** Atomically replace a private config while preserving restrictive permissions. */
export const writePrivateConfig = Effect.fn("notesCaptureSync.writeConfig")(
  function* (destination: string, content: string) {
    const fs = yield* FileSystem.FileSystem;

    const mode = (yield* fs.exists(destination))
      ? (yield* fs.stat(destination)).mode & 0o7777
      : 0o600;

    yield* Effect.try(() => writeFileAtomic(destination, content, { mode }));
  },
);

/** Regenerate the notes capture picker config from private watched repositories. */
export const notesCaptureSync = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const log = yield* OutputLog;

  yield* log.section("Notes Capture Sync");

  if (!config.canUsePrivate) {
    yield* log.warn(`Skipped: ${config.privateReason}`);

    return;
  }

  if (!config.gitConfig.present) {
    yield* log.warn(
      `Skipped (missing config): ${displayPath(config.gitConfig.filePath)}`,
    );

    return;
  }

  if (!config.gitConfig.valid) {
    yield* log.error(
      `Invalid config: ${displayPath(config.gitConfig.filePath)}`,
    );

    for (const diagnostic of config.gitConfig.diagnostics) {
      yield* log.error(`  ${diagnostic}`);
    }

    return yield* new NotesCaptureSyncError({
      message: `Invalid git config: ${displayPath(config.gitConfig.filePath)}`,
    });
  }

  const notes = config.gitConfig.repositories.find(
    ({ github }) => github?.toLowerCase() === NOTES_REPOSITORY,
  );

  if (!notes) {
    yield* log.warn(`Skipped (unmanaged repository): ${NOTES_REPOSITORY}`);

    return;
  }

  const destination = join(notes.path, CAPTURE_ENV_PATH);

  if (!(yield* fs.exists(destination).pipe(Effect.orDie))) {
    yield* log.warn(
      `Skipped (missing ${displayPath(destination)}, which holds the capture stack's vars)`,
    );

    return;
  }

  const repositories = captureRepositoryOptions(config.gitConfig.repositories);
  const source = yield* fs.readFileString(destination).pipe(Effect.orDie);

  const output = yield* Effect.try({
    try: () => setCaptureRepositories(source, repositories),
    catch: (error) =>
      new NotesCaptureSyncError({
        message: `Could not update ${displayPath(destination)}: ${String(error)}`,
      }),
  });

  const write = (content: string) =>
    writePrivateConfig(destination, content).pipe(
      Effect.mapError(
        (error) =>
          new NotesCaptureSyncError({
            message: `Could not write ${displayPath(destination)}: ${String(error)}`,
          }),
      ),
    );

  yield* log.info(
    `${repositories.length} repositor${repositories.length === 1 ? "y" : "ies"} -> ${displayPath(destination)}`,
  );

  if (output === source) {
    yield* log.info("Picker unchanged");

    return;
  }

  yield* write(output);

  // The github stack copies the env file into the repository secret CI
  // deploys with, so a later CI deploy keeps the new picker. Its deploy
  // script doesn't pass --yes itself
  for (const [args, label] of [
    [["docs:deploy:github", "--yes"], "the repository's capture secrets"],
    [["capture:deploy"], "notes-capture"],
  ] as const) {
    yield* log.info(`Deploying ${label}...`);

    const exitCode = yield* executor.inherit("mise", ["run", ...args], {
      cwd: notes.path,
    });

    if (exitCode !== 0) {
      // Put the old picker back so the next sync sees the change and retries
      yield* write(source);

      return yield* new NotesCaptureSyncError({
        message: `mise run ${args[0]} failed with exit code ${exitCode}`,
      });
    }
  }
});
