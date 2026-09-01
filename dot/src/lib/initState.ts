import { Effect, Schema } from "effect";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { displayPath } from "./paths.js";
import type { ConfigService } from "../services/Config.js";

interface InitMarkerOptions {
  readonly confirm?: boolean;
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

function writeJsonFile(
  path: string,
  value: InitMarker,
): Effect.Effect<void, InitStateError> {
  return Effect.try({
    try: () => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`),
    catch: (error) =>
      new InitStateError({
        message: `Could not write ${displayPath(path)}: ${String(error)}`,
      }),
  });
}

/** Write the in-progress marker for a first-use setup attempt. */
export function writeInitInProgressMarker(
  config: ConfigService,
  options: InitMarkerOptions,
): Effect.Effect<void, InitStateError> {
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
): Effect.Effect<void, InitStateError> {
  return Effect.gen(function* () {
    const inProgressMarker = initInProgressMarker(config);
    yield* writeJsonFile(initCompleteMarker(config), {
      status: "complete",
      completedAt: new Date().toISOString(),
      source,
    });

    if (existsSync(inProgressMarker)) {
      yield* Effect.try({
        try: () => unlinkSync(inProgressMarker),
        catch: (error) =>
          new InitStateError({
            message: `Could not remove ${displayPath(inProgressMarker)}: ${String(error)}`,
          }),
      });
    }
  });
}

/** Create a complete marker for already-configured machines after update. */
export function ensureInitCompleteMarker(
  config: ConfigService,
  source: InitCompleteSource,
): Effect.Effect<InitCompleteMarkerStatus, InitStateError> {
  return Effect.gen(function* () {
    if (existsSync(initCompleteMarker(config))) return "exists";
    if (existsSync(initInProgressMarker(config))) return "in-progress";
    yield* writeInitCompleteMarker(config, source);
    return "created";
  });
}
