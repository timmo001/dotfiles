import { Effect, FileSystem, Schema } from "effect";
import { hostname } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../lib/atomicWrite.js";
import { pathExists } from "../lib/fsProbe.js";
import { DATA_DIR } from "../lib/paths.js";
import { Config } from "../services/Config.js";
import { ScoredItem } from "./score.js";

/** How a handled item was resolved. */
const Resolution = Schema.Struct({
  /** `dismissed` hides it until new activity; `done` means it dropped off on its own. */
  state: Schema.Literals(["dismissed", "done"]),
  /** When the resolution was recorded. */
  at: Schema.String,
  /** The item's `updatedAt` when it was resolved. */
  updatedAt: Schema.String,
});

const Resolutions = Schema.Record(Schema.String, Resolution);

/** Decoded resolutions keyed by item id. */
export type Resolutions = typeof Resolutions.Type;

/** One posted report, kept so notes can refer to its `B` numbers. */
const Report = Schema.Struct({
  postedAt: Schema.String,
  /** Items by `B` number, such as `B3`. */
  items: Schema.Record(Schema.String, ScoredItem),
});

const LastReport = Schema.Struct({
  threadId: Schema.String,
  messageId: Schema.String,
  /** Dismiss option labels mapped back to item ids. */
  choices: Schema.Record(Schema.String, Schema.String),
  /** Recent reports by message id. */
  reports: Schema.Record(Schema.String, Report),
});

/** Decoded state of the last posted report. */
export type LastReport = typeof LastReport.Type;

const FollowUps = Schema.Array(Schema.String);

/** Directory holding the brief's state. */
export const briefStateDir = Effect.gen(function* () {
  const config = yield* Config;

  return join(config.stateDir, "brief");
});

const readJson = Effect.fn("brief.readState")(function* <S extends Schema.Top>(
  file: string,
  schema: S,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = join(yield* briefStateDir, file);

  if (!(yield* pathExists(path))) return undefined;

  return yield* fs
    .readFileString(path)
    .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(schema))));
});

const writeJson = Effect.fn("brief.writeState")(function* (
  file: string,
  json: string,
) {
  const path = join(yield* briefStateDir, file);

  yield* Effect.try(() =>
    writeFileAtomic(path, `${json}\n`, { createDirectory: true }),
  );
});

/**
 * Resolutions are synced between machines, so they live under the data root.
 * Each machine writes only its own file, which keeps Syncthing free of
 * conflicts, and reads every machine's.
 */
const RESOLUTIONS_DIR = join(DATA_DIR, "dot", "brief", "resolutions");

const LEGACY_RESOLUTIONS = "resolutions.json";

const ownResolutions = () => join(RESOLUTIONS_DIR, `${hostname()}.json`);

const decodeResolutions = Schema.decodeEffect(
  Schema.fromJsonString(Resolutions),
);

/** Every machine's item resolutions merged, newest first, empty when none are saved. */
export const readResolutions = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const own = ownResolutions();

  const others = (yield* pathExists(RESOLUTIONS_DIR))
    ? (yield* fs.readDirectory(RESOLUTIONS_DIR))
        .filter((name) => name.endsWith(".json"))
        .map((name) => join(RESOLUTIONS_DIR, name))
        .filter((path) => path !== own)
    : [];

  const files = [
    (yield* readJson(LEGACY_RESOLUTIONS, Resolutions)) ?? {},
    (yield* pathExists(own))
      ? yield* fs.readFileString(own).pipe(Effect.flatMap(decodeResolutions))
      : {},
    // Another machine's file may be mid-sync, so skip it rather than fail.
    ...(yield* Effect.forEach(others, (path) =>
      fs.readFileString(path).pipe(
        Effect.flatMap(decodeResolutions),
        Effect.orElseSucceed((): Resolutions => ({})),
      ),
    )),
  ];

  const merged: Record<string, Resolutions[string]> = {};

  for (const file of files)
    for (const [id, resolution] of Object.entries(file))
      if (!merged[id] || merged[id].at < resolution.at) merged[id] = resolution;

  return merged;
}).pipe(Effect.withSpan("brief.readResolutions"));

/** Save this machine's item resolutions. */
export const writeResolutions = Effect.fn("brief.writeResolutions")(function* (
  value: Resolutions,
) {
  const fs = yield* FileSystem.FileSystem;
  const legacy = join(yield* briefStateDir, LEGACY_RESOLUTIONS);

  yield* Effect.try(() =>
    writeFileAtomic(ownResolutions(), `${JSON.stringify(value, null, 2)}\n`, {
      createDirectory: true,
    }),
  );

  if (yield* pathExists(legacy)) yield* fs.remove(legacy);
});

/** The last posted report, if any. */
export const readLastReport = readJson("last.json", LastReport);

/** Save the last posted report. */
export const writeLastReport = (value: LastReport) =>
  writeJson("last.json", JSON.stringify(value, null, 2));

/** Ids of messages `dot brief follow-up` has already handled. */
export const readFollowUps = readJson("followups.json", FollowUps).pipe(
  Effect.map((value): readonly string[] => value ?? []),
);

/** Save handled follow-up message ids. */
export const writeFollowUps = (value: readonly string[]) =>
  writeJson("followups.json", JSON.stringify(value, null, 2));
