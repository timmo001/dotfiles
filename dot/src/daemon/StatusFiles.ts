/**
 * @file Mirrors the dot daemon's status into files, so the bar and the
 * OpenCode footer can watch them instead of each running a watcher process.
 * The directory only exists while the daemon runs: it is removed when the
 * daemon stops, and by the unit's ExecStopPost after a crash, so a missing
 * file means readers should check for themselves.
 */

import { join } from "node:path";
import { Effect, FileSystem, Layer, Option, Stream } from "effect";
import { writeFileAtomic } from "../lib/atomicWrite.js";
import { barOf, snapshotJson } from "../lib/updatesSnapshot.js";
import { GitStore } from "./GitStore.js";
import { ServicesStore } from "./ServicesStore.js";
import { STATUS_DIRECTORY } from "./socketPath.js";
import { UpdatesStore } from "./UpdatesStore.js";

/** The status files the daemon keeps, by what they hold. */
export const STATUS_FILES = {
  /** `dot updates status --json` output. */
  updates: join(STATUS_DIRECTORY, "updates.json"),
  /** `dot updates status` output: the bar's status JSON. */
  updatesBar: join(STATUS_DIRECTORY, "updates-bar.json"),
  /** `dot services status --json` output. */
  services: join(STATUS_DIRECTORY, "services.json"),
  /** `dot git watch` output: every part of the Git panel. */
  git: join(STATUS_DIRECTORY, "git.json"),
} as const;

const write = (file: string, json: string) =>
  Effect.try(() => writeFileAtomic(file, `${json}\n`, { mode: 0o600 })).pipe(
    Effect.catch((error) =>
      Effect.logWarning(`Couldn't write ${file}`, error.message),
    ),
  );

/** Keeps the status files in step with the daemon's stores while it runs. */
export const StatusFiles = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const updates = yield* UpdatesStore;
    const services = yield* ServicesStore;
    const git = yield* GitStore;

    yield* fs.makeDirectory(STATUS_DIRECTORY, { recursive: true, mode: 0o700 });
    yield* Effect.addFinalizer(() =>
      fs
        .remove(STATUS_DIRECTORY, { recursive: true, force: true })
        .pipe(Effect.ignore),
    );

    yield* updates.changes.pipe(
      Stream.runForEach((snapshot) => {
        const current = Option.getOrUndefined(snapshot);

        return write(
          STATUS_FILES.updates,
          JSON.stringify(snapshotJson(current)),
        ).pipe(
          Effect.andThen(
            write(STATUS_FILES.updatesBar, JSON.stringify(barOf(current))),
          ),
        );
      }),
      Effect.forkScoped,
    );

    yield* services.changes.pipe(
      Stream.runForEach((report) =>
        Option.match(report, {
          onNone: () => Effect.void,
          onSome: (value) =>
            write(STATUS_FILES.services, JSON.stringify(value)),
        }),
      ),
      Effect.forkScoped,
    );

    yield* git.changes.pipe(
      Stream.runForEach((snapshot) =>
        write(STATUS_FILES.git, JSON.stringify(snapshot)),
      ),
      Effect.forkScoped,
    );
  }),
);
