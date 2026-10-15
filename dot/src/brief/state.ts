import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { writeFileAtomic } from "../lib/atomicWrite.js";
import { pathExists } from "../lib/fsProbe.js";
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

/** Item resolutions, empty when none are saved. */
export const readResolutions = readJson("resolutions.json", Resolutions).pipe(
  Effect.map((value): Resolutions => value ?? {}),
);

/** Save item resolutions. */
export const writeResolutions = (value: Resolutions) =>
  writeJson("resolutions.json", JSON.stringify(value, null, 2));

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
