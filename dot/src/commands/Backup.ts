/**
 * @file `dot backup`: the Kopia jobs the `kopia--<host>` units run, against
 * the repository `KOPIA_CONFIG_PATH` (or Kopia's default config) is connected
 * to. A snapshot reports its progress to a status file for `dot services` and
 * System Bridge, and a test restore checks that files come back from the
 * newest snapshots as they went in.
 */
import {
  Cache,
  Clock,
  Effect,
  FileSystem,
  Option,
  Random,
  Result,
  Schedule,
  Schema,
} from "effect";
import { join } from "node:path";
import { CommandError, CommandExecutor } from "../services/CommandExecutor.js";
import { type ReportedStatus, writeReportedStatus } from "./Services.js";

/** The exit code for a snapshot skipped because the repository didn't answer. */
const SKIPPED = 75;

/** How often to ask the repository again while waiting for it. */
const REPOSITORY_POLL = "15 seconds";

/** Random walks a test restore tries for each source before giving up on it. */
const PICK_TRIES = 20;

/** Deepest a random walk goes before starting again from the root. */
const PICK_DEPTH = 32;

/** Directory listings a test restore keeps while it runs. */
const LISTING_CACHE = 1000;

const KopiaSnapshot = Schema.Struct({
  id: Schema.String,
  source: Schema.Struct({
    host: Schema.String,
    userName: Schema.String,
    path: Schema.String,
  }),
  startTime: Schema.String,
  endTime: Schema.optional(Schema.String),
  rootEntry: Schema.Struct({
    obj: Schema.String,
    summ: Schema.optional(
      Schema.Struct({
        files: Schema.optional(Schema.Finite),
        size: Schema.optional(Schema.Finite),
      }),
    ),
  }),
});

type KopiaSnapshot = typeof KopiaSnapshot.Type;

const decodeSnapshots = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(KopiaSnapshot)),
);

const KopiaEntry = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  size: Schema.optional(Schema.Finite),
  mtime: Schema.optional(Schema.String),
  obj: Schema.String,
});

const decodeDirectory = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ entries: Schema.Array(KopiaEntry) })),
);

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** A size such as `1.2 GB`, in powers of 1000 as Kopia prints them. */
const formatSize = (bytes: number) => {
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }

  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
};

const lastLine = (error: CommandError | { readonly message: string }) =>
  (error instanceof CommandError ? error.stderr : error.message)
    .trim()
    .split("\n")
    .at(-1) ?? "";

/** Write the status file when there is one, stamping when it was written. */
const reporter = (file: string | undefined) =>
  Effect.fn("Backup.report")(function* (
    status: Omit<ReportedStatus, "updated">,
  ) {
    if (file === undefined) return;

    const updated = yield* Clock.currentTimeMillis;

    yield* writeReportedStatus(file, { ...status, updated }).pipe(
      Effect.catchCause(() =>
        Effect.logWarning(`Couldn't write the status file ${file}`),
      ),
    );
  });

/** The newest snapshots, one per source, or of one source. */
const newestSnapshots = Effect.fn("Backup.newestSnapshots")(function* (
  source?: string,
) {
  const executor = yield* CommandExecutor;

  const output = yield* executor.run("kopia", [
    "snapshot",
    "list",
    "--json",
    "--max-results=1",
    ...(source === undefined ? ["--all"] : [source]),
  ]);

  return yield* decodeSnapshots(output);
});

/** Options for {@link backupSnapshot}. */
export interface BackupSnapshotOptions {
  /** How long to wait for the repository to answer, in milliseconds. */
  readonly wait?: number;
  /** Where to report progress for `dot services`. */
  readonly statusFile?: string;
}

/**
 * Snapshot each source in turn, reporting which one is running and, at the
 * end, each one's size. Exits 75 when the repository doesn't answer within
 * `wait`, so a unit that only backs up while the NAS is on can count it as
 * skipped, and 1 when any source fails.
 */
export const backupSnapshot = Effect.fn("Backup.snapshot")(function* (
  sources: readonly string[],
  options: BackupSnapshotOptions,
) {
  const executor = yield* CommandExecutor;
  const report = reporter(options.statusFile);

  if (options.wait !== undefined) {
    yield* report({
      health: "ok",
      busy: true,
      summary: "Waiting for the repository",
    });

    const answered = yield* executor
      .exitCode("kopia", ["repository", "status"])
      .pipe(
        Effect.repeat({
          until: (code) => code === 0,
          schedule: Schedule.spaced(REPOSITORY_POLL),
        }),
        Effect.timeoutOption(options.wait),
      );

    if (Option.isNone(answered)) {
      yield* Effect.logWarning("The repository didn't answer in time");
      yield* report({
        health: "ok",
        busy: false,
        summary: "Skipped: the repository didn't answer",
      });
      process.exitCode = SKIPPED;

      return;
    }
  }

  const results: Array<{
    readonly source: string;
    readonly ok: boolean;
    /** The new snapshot, when its totals could be read back. */
    readonly snapshot: KopiaSnapshot | undefined;
  }> = [];

  for (const [index, source] of sources.entries()) {
    yield* report({
      health: "ok",
      busy: true,
      progress: index / sources.length,
      summary: `Backing up ${source} (${index + 1} of ${sources.length})`,
    });
    yield* Effect.logInfo(`Snapshot of ${source}`);

    const exitCode = yield* executor.inherit("kopia", [
      "snapshot",
      "create",
      source,
    ]);

    if (exitCode !== 0) {
      yield* Effect.logError(`Snapshot of ${source} failed`);
      results.push({ source, ok: false, snapshot: undefined });

      continue;
    }

    const newest = yield* newestSnapshots(source).pipe(
      Effect.map((snapshots) => snapshots[0]),
      Effect.orElseSucceed(() => undefined),
    );

    results.push({ source, ok: true, snapshot: newest });
  }

  const failed = results.filter(({ ok }) => !ok);

  const totals = results.flatMap(({ snapshot }) =>
    snapshot?.rootEntry.summ === undefined ? [] : [snapshot.rootEntry.summ],
  );

  yield* report({
    health: failed.length > 0 ? "failed" : "ok",
    busy: false,
    summary:
      failed.length > 0
        ? `${failed.map(({ source }) => source).join(", ")} failed`
        : `Backed up ${plural(results.length, "source")}`,
    stats: [
      {
        id: "size",
        label: "Size",
        value: totals.reduce((sum, summ) => sum + (summ.size ?? 0), 0),
        unit: "B",
        kind: "size",
      },
      {
        id: "files",
        label: "Files",
        value: totals.reduce((sum, summ) => sum + (summ.files ?? 0), 0),
        kind: "count",
      },
    ],
    lists: [
      {
        id: "sources",
        label: "Sources",
        items: results.map(({ source, ok, snapshot }) => ({
          label: source,
          value: !ok
            ? "failed"
            : snapshot?.rootEntry.summ === undefined
              ? "backed up"
              : `${formatSize(snapshot.rootEntry.summ.size ?? 0)}, ${plural(snapshot.rootEntry.summ.files ?? 0, "file")}`,
        })),
      },
    ],
  });

  if (failed.length > 0) process.exitCode = 1;
});

/** Read back a share of the repository's files, exiting as Kopia does. */
export const backupVerify = Effect.fn("Backup.verify")(function* (
  percent: number,
) {
  const executor = yield* CommandExecutor;

  const exitCode = yield* executor.inherit("kopia", [
    "snapshot",
    "verify",
    `--verify-files-percent=${percent}`,
  ]);

  if (exitCode !== 0) process.exitCode = exitCode;
});

/** Options for {@link backupTestRestore}. */
export interface BackupTestRestoreOptions {
  /** Files to restore from each source. */
  readonly files: number;
  /** Largest file to pick, in bytes, so off-site restores stay small. */
  readonly maxSize: number;
  /** Where to report the result for `dot services`. */
  readonly statusFile?: string;
}

interface Picked {
  readonly path: string;
  readonly size: number;
  readonly mtime: number | undefined;
}

/** A directory's entries as `kopia show` lists them. */
type Directory = Effect.Success<ReturnType<typeof decodeDirectory>>;

/**
 * Walk down from a snapshot's root to a random file no bigger than
 * `maxSize`, choosing a random file or directory at each level. `list` reads
 * a directory, through a cache, since every walk starts from the same root.
 */
const pickFile = Effect.fn("Backup.pickFile")(function* <E>(
  root: string,
  maxSize: number,
  list: (obj: string) => Effect.Effect<Directory, E>,
) {
  let obj = root;
  let path: string[] = [];

  for (let depth = 0; depth < PICK_DEPTH; depth++) {
    const directory = yield* list(obj);

    const choices = directory.entries.filter(
      (entry) =>
        entry.type === "d" ||
        (entry.type === "f" && (entry.size ?? 0) <= maxSize),
    );

    if (choices.length === 0) return Option.none<Picked>();

    const entry = yield* Random.choice(choices);

    path = [...path, entry.name];

    if (entry.type === "f")
      return Option.some<Picked>({
        path: path.join("/"),
        size: entry.size ?? 0,
        mtime: entry.mtime === undefined ? undefined : Date.parse(entry.mtime),
      });

    obj = entry.obj;
  }

  return Option.none<Picked>();
});

/** How one restored file checked out. */
interface Checked {
  readonly failed: boolean;
  readonly value: string;
}

/**
 * Restore one picked file into the scratch directory and check it: its size
 * against the snapshot, and its bytes against the original when that's on
 * this machine and unchanged since the snapshot.
 */
const restoreFile = Effect.fn("Backup.restoreFile")(function* (
  snapshot: KopiaSnapshot,
  picked: Picked,
  target: string,
) {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const failed = (value: string): Checked => ({ failed: true, value });

  const restored = yield* executor
    .run("kopia", [
      "snapshot",
      "restore",
      `${snapshot.id}/${picked.path}`,
      target,
    ])
    .pipe(Effect.result);

  if (Result.isFailure(restored))
    return failed(`restore failed: ${lastLine(restored.failure)}`);

  const info = yield* fs.stat(target).pipe(Effect.option);

  if (Option.isNone(info)) return failed("restore wrote nothing");

  const size = Number(info.value.size);

  if (size !== picked.size)
    return failed(
      `restored ${formatSize(size)}, expected ${formatSize(picked.size)}`,
    );

  // Only a live file with the snapshot's size and modification time is the
  // same file; anything else changed since, or is on another machine.
  const original = join(snapshot.source.path, picked.path);
  const live = yield* fs.stat(original).pipe(Effect.option);

  const unchanged =
    Option.isSome(live) &&
    picked.mtime !== undefined &&
    Option.isSome(live.value.mtime) &&
    Math.abs(live.value.mtime.value.getTime() - picked.mtime) < 1 &&
    Number(live.value.size) === picked.size;

  if (!unchanged) return { failed: false, value: "restored" };

  const bytes = yield* Effect.all([
    fs.readFile(target),
    fs.readFile(original),
  ]).pipe(Effect.option);

  if (Option.isNone(bytes)) return { failed: false, value: "restored" };

  const [restoredBytes, originalBytes] = bytes.value;

  return Buffer.from(restoredBytes).equals(Buffer.from(originalBytes))
    ? { failed: false, value: "matches the original" }
    : failed("differs from the original");
});

/**
 * Restore a few random files from each source's newest snapshot into a
 * scratch directory, removed afterwards, and check each one. Exits 1 when any
 * restore or comparison fails.
 */
export const backupTestRestore = Effect.fn("Backup.testRestore")(function* (
  options: BackupTestRestoreOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;
  const report = reporter(options.statusFile);

  yield* report({
    health: "ok",
    busy: true,
    summary: "Restoring a sample of files",
  });

  const snapshots = yield* newestSnapshots().pipe(Effect.result);

  if (Result.isFailure(snapshots)) {
    const message = `Can't read the repository: ${lastLine(snapshots.failure)}`;

    yield* Effect.logError(message);
    yield* report({ health: "failed", busy: false, summary: message });
    process.exitCode = 1;

    return;
  }

  const scratch = yield* fs.makeTempDirectoryScoped({
    prefix: "dot-backup-restore-",
  });

  // Each kopia call costs seconds against a repository server, so a
  // directory is listed once however many walks pass through it.
  const listings = yield* Cache.make({
    capacity: LISTING_CACHE,
    lookup: (obj: string) =>
      executor
        .run("kopia", ["show", obj])
        .pipe(Effect.flatMap(decodeDirectory)),
  });

  const list = (obj: string) => Cache.get(listings, obj);

  const checked: Array<{ readonly label: string; readonly value: string }> = [];
  let failures = 0;
  let restored = 0;

  for (const snapshot of snapshots.success) {
    const source = `${snapshot.source.userName}@${snapshot.source.host}:${snapshot.source.path}`;
    const picks: Picked[] = [];

    for (
      let tries = 0;
      tries < PICK_TRIES && picks.length < options.files;
      tries++
    ) {
      const picked = yield* pickFile(
        snapshot.rootEntry.obj,
        options.maxSize,
        list,
      ).pipe(Effect.orElseSucceed(() => Option.none<Picked>()));

      if (
        Option.isSome(picked) &&
        !picks.some(({ path }) => path === picked.value.path)
      )
        picks.push(picked.value);
    }

    if (picks.length === 0) {
      checked.push({ label: source, value: "no file to restore" });
      continue;
    }

    for (const picked of picks) {
      const target = join(scratch, String(checked.length));
      const result = yield* restoreFile(snapshot, picked, target);
      const label = `${source}/${picked.path}`;

      if (result.failed) {
        failures += 1;
        yield* Effect.logError(`${label}: ${result.value}`);
      } else {
        restored += 1;
        yield* Effect.logInfo(`${label}: ${result.value}`);
      }

      checked.push({ label, value: result.value });
    }
  }

  yield* report({
    health: failures > 0 ? "failed" : "ok",
    busy: false,
    summary:
      failures > 0
        ? `${plural(failures, "file")} didn't restore`
        : `Restored ${plural(restored, "file")} from ${plural(snapshots.success.length, "source")}`,
    stats: [
      { id: "restored", label: "Restored", value: restored, kind: "count" },
      { id: "failed", label: "Failed", value: failures, kind: "count" },
    ],
    lists: [{ id: "files", label: "Files", items: checked }],
  });

  if (failures > 0) process.exitCode = 1;
}, Effect.scoped);
