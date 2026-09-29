import { Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { displayPath } from "./paths.js";
import { pathExists } from "./fsProbe.js";
import type { ConfigService } from "../services/Config.js";

interface InitMarkerOptions {
  readonly noninteractive?: boolean;
  readonly force?: boolean;
  readonly host?: string;
  readonly log?: string;
}

type InitMarker =
  | {
      readonly status: "in-progress";
      readonly startedAt: string;
      readonly options: InitMarkerOptions;
    }
  | {
      readonly status: "complete";
      readonly completedAt: string;
      readonly source: InitCompleteSource;
    };

/** Domain error for init state marker failures. */
class InitStateError extends Schema.TaggedError<InitStateError>()(
  "InitStateError",
  {
    message: Schema.String,
  },
) {}

/** What triggered writing the first-use setup complete marker. */
type InitCompleteSource = "init" | "update";

/** Outcome of ensuring the first-use setup complete marker exists. */
export type InitCompleteMarkerStatus = "created" | "exists" | "in-progress";

/** Return the complete marker path for first-use setup state. */
export function initCompleteMarker(config: ConfigService): string {
  return join(config.stateDir, "init.json");
}

/** Return the in-progress marker path for first-use setup state. */
export function initInProgressMarker(config: ConfigService): string {
  return join(config.stateDir, "init.in-progress.json");
}

const writeJsonFile = Effect.fn("InitState.writeJsonFile")(function* (
  path: string,
  value: InitMarker,
) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.writeFileString(path, `${JSON.stringify(value, null, 2)}\n`).pipe(
    Effect.mapError(
      (error) =>
        new InitStateError({
          message: `Could not write ${displayPath(path)}: ${error.message}`,
        }),
    ),
  );
});

/** Write the in-progress marker for a first-use setup attempt. */
export function writeInitInProgressMarker(
  config: ConfigService,
  options: InitMarkerOptions,
): Effect.Effect<void, InitStateError, FileSystem.FileSystem> {
  return writeJsonFile(initInProgressMarker(config), {
    status: "in-progress",
    startedAt: new Date().toISOString(),
    options,
  });
}

/** Write the complete marker and clear any stale in-progress marker. */
export function writeInitCompleteMarker(
  config: ConfigService,
  source: InitCompleteSource,
): Effect.Effect<void, InitStateError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const inProgressMarker = initInProgressMarker(config);
    yield* writeJsonFile(initCompleteMarker(config), {
      status: "complete",
      completedAt: new Date().toISOString(),
      source,
    });

    if (yield* pathExists(inProgressMarker)) {
      const fs = yield* FileSystem.FileSystem;

      yield* fs.remove(inProgressMarker).pipe(
        Effect.mapError(
          (error) =>
            new InitStateError({
              message: `Could not remove ${displayPath(inProgressMarker)}: ${error.message}`,
            }),
        ),
      );
    }
  });
}

/** Create a complete marker for already-configured machines after update. */
export function ensureInitCompleteMarker(
  config: ConfigService,
  source: InitCompleteSource,
): Effect.Effect<
  InitCompleteMarkerStatus,
  InitStateError,
  FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    if (yield* pathExists(initCompleteMarker(config))) return "exists";

    if (yield* pathExists(initInProgressMarker(config))) return "in-progress";
    yield* writeInitCompleteMarker(config, source);

    return "created";
  });
}
