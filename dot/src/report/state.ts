import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { writeFileAtomic } from "../lib/atomicWrite.js";
import { pathExists } from "../lib/fsProbe.js";
import { STATE_DIR } from "../lib/paths.js";
import type { SectionResult } from "./result.js";

/** One section's numbers and keyed items from a run. */
const SectionSnapshot = Schema.Struct({
  counts: Schema.Record(Schema.String, Schema.Finite),
  /** Item key to its state: a file's bucket, a PR's title, a check's state. */
  items: Schema.Record(Schema.String, Schema.String),
});

/** Decoded {@link SectionSnapshot}. */
export type SectionSnapshot = typeof SectionSnapshot.Type;

const RunSnapshot = Schema.Struct({
  at: Schema.String,
  sections: Schema.Record(Schema.String, SectionSnapshot),
  /** The Inbox message the run posted, so the next run can withdraw its question. */
  message: Schema.optionalKey(
    Schema.Struct({ threadId: Schema.String, messageId: Schema.String }),
  ),
});

/** Decoded numbers of one run, compared with the next. */
export type RunSnapshot = typeof RunSnapshot.Type;

/** Folder holding a report's last run and its pages. */
export const reportStateDir = (name: string) =>
  join(STATE_DIR, "dot", "reports", name);

const lastPath = (name: string) => join(reportStateDir(name), "last.json");

/** The last run's snapshot, if there is one. */
export const readLastRun = Effect.fn("report.readLastRun")(function* (
  name: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = lastPath(name);

  if (!(yield* pathExists(path))) return undefined;

  return yield* fs
    .readFileString(path)
    .pipe(
      Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(RunSnapshot))),
    );
});

/** Save this run's snapshot. */
export const writeLastRun = Effect.fn("report.writeLastRun")(function* (
  name: string,
  snapshot: RunSnapshot,
) {
  yield* Effect.try(() =>
    writeFileAtomic(lastPath(name), `${JSON.stringify(snapshot, null, 2)}\n`, {
      createDirectory: true,
    }),
  );
});

/** Save a run's page as `<date>.html` and return its path. */
export const writeRunPage = Effect.fn("report.writeRunPage")(function* (
  name: string,
  file: string,
  html: string,
) {
  const path = join(reportStateDir(name), file);

  yield* Effect.try(() =>
    writeFileAtomic(path, html, { createDirectory: true }),
  );

  return path;
});

/** Numbers and keyed items of one section result. */
export function sectionSnapshot(result: SectionResult): SectionSnapshot {
  switch (result.type) {
    case "code":
      return {
        counts: result.counts,
        items: Object.fromEntries(
          result.files.map((file) => [file.path, file.bucket]),
        ),
      };
    case "github":
      return {
        counts: { total: result.items.length },
        items: Object.fromEntries(
          result.items.map((item) => [`#${item.number}`, item.title]),
        ),
      };
    case "checks":
      return {
        counts: Object.fromEntries(
          (["active", "resolved", "missing"] as const).map((state) => [
            state,
            result.checks.filter((check) => check.state === state).length,
          ]),
        ),
        items: Object.fromEntries(
          result.checks.map((check) => [check.title, check.state]),
        ),
      };
    case "dependencies":
      return {
        counts: result.counts,
        items: Object.fromEntries(
          result.files.map((file) => [file.path, file.category]),
        ),
      };
  }
}

/** What changed in one section since the last run. */
export interface SectionChanges {
  /** Count changes by name, only where the number moved. */
  readonly counts: Readonly<
    Record<string, { readonly before: number; readonly after: number }>
  >;
  /** Keys that appeared, with their state now. */
  readonly added: readonly { readonly key: string; readonly to: string }[];
  /** Keys that went, with their state before. */
  readonly removed: readonly { readonly key: string; readonly from: string }[];
  /** Keys whose state changed. */
  readonly moved: readonly {
    readonly key: string;
    readonly from: string;
    readonly to: string;
  }[];
}

/** Changes per section id, or `undefined` for a first run. */
export type RunChanges = Readonly<Record<string, SectionChanges>> | undefined;

/** Compare this run's snapshot with the last one. Sections new since then show every item as added. */
export function compareRuns(
  last: RunSnapshot | undefined,
  current: RunSnapshot,
): RunChanges {
  if (!last) return undefined;

  return Object.fromEntries(
    Object.entries(current.sections).map(([id, now]) => {
      const before = last.sections[id] ?? { counts: {}, items: {} };

      const counts = Object.fromEntries(
        [
          ...new Set([
            ...Object.keys(before.counts),
            ...Object.keys(now.counts),
          ]),
        ].flatMap((key) => {
          const change = {
            before: before.counts[key] ?? 0,
            after: now.counts[key] ?? 0,
          };

          return change.before === change.after ? [] : [[key, change] as const];
        }),
      );

      const added = Object.entries(now.items)
        .filter(([key]) => !(key in before.items))
        .map(([key, to]) => ({ key, to }));

      const removed = Object.entries(before.items)
        .filter(([key]) => !(key in now.items))
        .map(([key, from]) => ({ key, from }));

      const moved = Object.entries(now.items).flatMap(([key, to]) => {
        const from = before.items[key];

        return from !== undefined && from !== to ? [{ key, from, to }] : [];
      });

      return [id, { counts, added, removed, moved }] as const;
    }),
  );
}
