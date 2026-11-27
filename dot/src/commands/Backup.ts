/**
 * @file `dot backup`: the Kopia jobs the `kopia--<host>` units run, against
 * the repository `KOPIA_CONFIG_PATH` (or Kopia's default config) is connected
 * to. A snapshot reports its progress to a status file for `dot services` and
 * System Bridge, and a test restore checks that files come back from the
 * newest snapshots as they went in. A change check compares the sources with
 * fingerprints a snapshot recorded, so a unit can skip waking the repository.
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
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { CommandError, CommandExecutor } from "../services/CommandExecutor.js";
import {
  type ReportedStatus,
  readReportedStatusFile,
  writeReportedStatus,
} from "./Services.js";

/**
 * The exit code for a snapshot skipped because the repository didn't answer,
 * and for a change check that found nothing to back up.
 */
const SKIPPED = 75;

/** Files a fingerprint reads the details of at once. */
const FINGERPRINT_CONCURRENCY = 32;

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

/**
 * How far Kopia's progress line says a snapshot has got, such as
 * `estimated 2.3 GB (52.1%) 1m5s left`, once it has estimated the size.
 */
const KOPIA_PERCENT = /\((\d+(?:\.\d+)?)%\) .* left/;

/** Kopia's progress line, which it redraws on stderr while a snapshot runs. */
const KOPIA_PROGRESS = /^ [|/\-\\*] \d+ hashing, /;

/** How often Kopia redraws its progress line, so the status file isn't rewritten every 300 ms. */
const KOPIA_PROGRESS_INTERVAL = "5s";

/** The least change in overall progress, from 0 to 1, worth reporting. */
const PROGRESS_STEP = 0.01;

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

const decodeFingerprints = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

/**
 * A hash of the path, type, size and modification time of everything under
 * `source`, so a change shows without asking the repository. None when the
 * source can't be listed, which counts as a change.
 */
const fingerprint = Effect.fn("Backup.fingerprint")(function* (source: string) {
  const fs = yield* FileSystem.FileSystem;
  const names = yield* fs.readDirectory(source, { recursive: true });

  const entries = yield* Effect.forEach(
    [...names].sort(),
    (name) =>
      fs.stat(join(source, name)).pipe(
        Effect.map((info) =>
          [
            name,
            info.type,
            String(info.size),
            Option.match(info.mtime, {
              onNone: () => "",
              onSome: (mtime) => String(mtime.getTime()),
            }),
          ].join("\0"),
        ),
        // Removed since the listing, or unreadable
        Effect.orElseSucceed(() => `${name}\0missing`),
      ),
    { concurrency: FINGERPRINT_CONCURRENCY },
  );

  return createHash("sha256").update(entries.join("\n")).digest("hex");
}, Effect.option);

/** Each source's fingerprint at its last snapshot, or none yet. */
const readFingerprints = Effect.fn("Backup.readFingerprints")(function* (
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFileString(file).pipe(
    Effect.flatMap(decodeFingerprints),
    Effect.orElseSucceed((): Record<string, string> => ({})),
  );
});

/** Atomically add the fingerprints of sources just backed up. */
const recordFingerprints = Effect.fn("Backup.recordFingerprints")(
  function* (file: string, recorded: Record<string, string>) {
    const fs = yield* FileSystem.FileSystem;
    const saved = yield* readFingerprints(file);
    const temporary = `${file}.tmp`;

    yield* fs.makeDirectory(dirname(file), { recursive: true });
    yield* fs.writeFileString(
      temporary,
      JSON.stringify({ ...saved, ...recorded }),
    );
    yield* fs.rename(temporary, file);
  },
  Effect.catchCause(() =>
    Effect.logWarning("Couldn't record the sources' fingerprints"),
  ),
);

/** Options for {@link backupChanged}. */
export interface BackupChangedOptions {
  /** Where `dot backup snapshot --fingerprints` records the last backup. */
  readonly fingerprints: string;
  /** The snapshot's status file, told when nothing changed. */
  readonly statusFile?: string;
}

/**
 * Exit 0 when any source differs from its fingerprint at the last backup, or
 * has none, and 75 when none does, so a unit can leave the NAS off. A skip
 * notes it in the status file, keeping the last backup's figures.
 */
export const backupChanged = Effect.fn("Backup.changed")(function* (
  sources: readonly string[],
  options: BackupChangedOptions,
) {
  const saved = yield* readFingerprints(options.fingerprints);

  for (const source of sources) {
    const current = yield* fingerprint(source);

    if (Option.isNone(current) || saved[source] !== current.value) {
      yield* Effect.logInfo(`${source} changed since the last backup`);

      return;
    }
  }

  yield* Effect.logInfo("Nothing changed since the last backup");

  if (options.statusFile !== undefined) {
    const previous = Option.getOrUndefined(
      yield* readReportedStatusFile(options.statusFile),
    );

    yield* reporter(options.statusFile)({
      health: "ok",
      busy: false,
      summary: "Nothing changed since the last backup",
      ...(previous?.stats && { stats: previous.stats }),
      ...(previous?.lists && { lists: previous.lists }),
    });
  }

  process.exitCode = SKIPPED;
});

/** Options for {@link backupSnapshot}. */
export interface BackupSnapshotOptions {
  /** How long to wait for the repository to answer, in milliseconds. */
  readonly wait?: number;
  /** Where to report progress for `dot services`. */
  readonly statusFile?: string;
  /** Where to record each backed-up source's fingerprint for `dot backup changed`. */
  readonly fingerprints?: string;
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

  const recorded: Record<string, string> = {};

  for (const [index, source] of sources.entries()) {
    const summary = `Backing up ${source} (${index + 1} of ${sources.length})`;
    let reported = index / sources.length;

    yield* report({ health: "ok", busy: true, progress: reported, summary });
    yield* Effect.logInfo(`Snapshot of ${source}`);

    // Taken before the snapshot, so a change during it shows next time
    const print =
      options.fingerprints === undefined
        ? Option.none<string>()
        : yield* fingerprint(source);

    // Kopia's progress moves this source's share of the whole. Its
    // redrawn progress line stays out of the journal; anything else it
    // says on stderr, such as an error, passes through.
    const onLine = (line: string) => {
      const percent = KOPIA_PERCENT.exec(line)?.[1];

      if (percent !== undefined) {
        const progress =
          (index + Math.min(Number(percent), 100) / 100) / sources.length;

        if (progress - reported < PROGRESS_STEP) return Effect.void;

        reported = progress;

        return report({ health: "ok", busy: true, progress, summary });
      }

      if (KOPIA_PROGRESS.test(line) || line.trim() === "") return Effect.void;

      return Effect.sync(() => process.stderr.write(`${line}\n`));
    };

    const exitCode = yield* executor.watch(
      "kopia",
      [
        "snapshot",
        "create",
        "--progress",
        `--progress-update-interval=${KOPIA_PROGRESS_INTERVAL}`,
        source,
      ],
      onLine,
    );

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

    if (Option.isSome(print)) recorded[source] = print.value;
  }

  if (options.fingerprints !== undefined && Object.keys(recorded).length > 0)
    yield* recordFingerprints(options.fingerprints, recorded);

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
