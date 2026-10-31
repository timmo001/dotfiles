import { hostname } from "node:os";
import { join } from "node:path";
import { Data, Effect, FileSystem, Schema } from "effect";
import { OutputLog } from "../services/OutputLog.js";
import { writeFileAtomic } from "../lib/atomicWrite.js";
import { CONFIG_DIR, STATE_DIR, displayPath } from "../lib/paths.js";
import { plural } from "../lib/runSummary.js";
import { notable, skip, warn } from "../lib/updateSummary.js";
import type { RecapEntry } from "../lib/updateSummary.js";

/** The saved SSH machines every device should have, stowed from the private overlay. */
export const HERDR_MACHINES_CONFIG_PATH = join(
  CONFIG_DIR,
  "dot",
  "herdr-machines.yml",
);

/** Herdr's own saved-machine catalog, which it keeps in client state rather than config. */
export const HERDR_MACHINES_CATALOG_PATH = join(
  STATE_DIR,
  "herdr",
  "client",
  "endpoints.json",
);

/** Herdr's profile IDs: opaque, but kept the same everywhere so `--machine` IDs match. */
const ProfileId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/));

const ConfiguredMachine = Schema.Struct({
  id: ProfileId,
  label: Schema.String,
  target: Schema.String,
  session: Schema.optionalKey(Schema.String),
  /** Only for a device that doesn't have the machine yet; later toggles are kept. */
  enabled: Schema.optionalKey(Schema.Boolean),
  /** The machine's own hostname, where it isn't saved so a device never lists itself. */
  host: Schema.optionalKey(Schema.String),
});

const HerdrMachinesConfig = Schema.Struct({
  machines: Schema.Array(ConfiguredMachine),
});

const SavedMachine = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  target: Schema.String,
  session: Schema.String,
  enabled: Schema.Boolean,
});

interface SavedMachine extends Schema.Schema.Type<typeof SavedMachine> {}

const Catalog = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    ssh: Schema.Array(SavedMachine),
  }),
);

/** Failure to read the machine list or Herdr's catalog, or to write the catalog. */
class SetupHerdrMachinesError extends Schema.TaggedError<SetupHerdrMachinesError>()(
  "SetupHerdrMachinesError",
  { message: Schema.String },
) {}

const failWith = (path: string) =>
  Effect.mapError(
    (cause: { readonly message: string }) =>
      new SetupHerdrMachinesError({
        message: `read ${displayPath(path)}: ${cause.message}`,
      }),
  );

type Outcome = Data.TaggedEnum<{
  Missing: {};
  Unchanged: {};
  Saved: { readonly saved: number; readonly kept: number };
}>;

const Outcome = Data.taggedEnum<Outcome>();

/**
 * Write the private machine list into Herdr's catalog, in its order, and only
 * when that changes it. Saved machines keep their enabled state, ones saved
 * under another ID with the same target and session are replaced, and the rest
 * the list doesn't name are kept after it, so a device's own additions and
 * toggles survive. A machine whose host is this device is left out, and
 * removed if it was saved. Callers decide what to say about the outcome.
 */
const applyHerdrMachines = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(HERDR_MACHINES_CONFIG_PATH))) return Outcome.Missing();

  const config = yield* fs.readFileString(HERDR_MACHINES_CONFIG_PATH).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(HerdrMachinesConfig)),
    failWith(HERDR_MACHINES_CONFIG_PATH),
  );

  const current = (yield* fs.exists(HERDR_MACHINES_CATALOG_PATH))
    ? yield* fs
        .readFileString(HERDR_MACHINES_CATALOG_PATH)
        .pipe(failWith(HERDR_MACHINES_CATALOG_PATH))
    : null;

  const saved: readonly SavedMachine[] =
    current === null
      ? []
      : (yield* Schema.decodeEffect(Catalog)(current).pipe(
          failWith(HERDR_MACHINES_CATALOG_PATH),
        )).ssh;

  const named = config.machines.map((machine) => ({
    ...machine,
    session: machine.session ?? "default",
  }));

  const localHost = hostname();
  const listed = named.filter((machine) => machine.host !== localHost);

  // A machine this device saved itself, under its own ID, before the list
  // named it: the listed one replaces it rather than sitting beside it.
  const sameMachine =
    (machine: { readonly target: string; readonly session: string }) =>
    (entry: SavedMachine) =>
      entry.target === machine.target && entry.session === machine.session;

  const machines = [
    ...listed.map((machine) => ({
      id: machine.id,
      label: machine.label,
      target: machine.target,
      session: machine.session,
      enabled:
        saved.find((entry) => entry.id === machine.id)?.enabled ??
        saved.find(sameMachine(machine))?.enabled ??
        machine.enabled ??
        true,
    })),
    // This device's own entry is dropped too, should it have been saved before.
    ...saved.filter(
      (entry) =>
        !named.some(
          (machine) => machine.id === entry.id || sameMachine(machine)(entry),
        ),
    ),
  ];

  // In Herdr's own format, without a final newline, so a toggle doesn't read as a change.
  const content = JSON.stringify({ version: 1, ssh: machines }, null, 2);

  if (current === content) return Outcome.Unchanged();

  yield* Effect.try({
    try: () =>
      writeFileAtomic(HERDR_MACHINES_CATALOG_PATH, content, {
        mode: 0o600,
        createDirectory: true,
      }),
    catch: (cause) =>
      new SetupHerdrMachinesError({
        message: `write ${displayPath(HERDR_MACHINES_CATALOG_PATH)}: ${String(cause)}`,
      }),
  });

  return Outcome.Saved({
    saved: listed.length,
    kept: machines.length - listed.length,
  });
}).pipe(Effect.withSpan("SetupHerdrMachines.apply"));

const savedMessage = ({ saved, kept }: { saved: number; kept: number }) =>
  `Saved ${plural(saved, "Herdr machine")}${kept > 0 ? `, and kept ${plural(kept, "machine")} only this device has` : ""}`;

const RECONNECT_HINT =
  "Open Herdr clients pick these up. For a new machine, run herdr machine reconnect <label> once to accept its host key";

/** `dot setup herdr machines`, which fails when this device has no machine list. */
export const setupHerdrMachines = Effect.gen(function* () {
  const log = yield* OutputLog;

  yield* log.section("Herdr Machines");

  const outcome = yield* applyHerdrMachines;

  yield* Outcome.$match(outcome, {
    Missing: () =>
      new SetupHerdrMachinesError({
        message: `No machine list at ${displayPath(HERDR_MACHINES_CONFIG_PATH)}; it comes from the private dot-config package`,
      }),
    Unchanged: () =>
      log.info(
        `Herdr machines already match ${displayPath(HERDR_MACHINES_CONFIG_PATH)}`,
      ),
    Saved: (counts) =>
      log
        .success(savedMessage(counts))
        .pipe(Effect.andThen(log.info(RECONNECT_HINT))),
  });
}).pipe(Effect.withSpan("SetupHerdrMachines"));

/**
 * The `dot update` step. It only shows up when it saves machines or fails:
 * a device without a list, or whose machines already match, stays quiet, and
 * a failure becomes a warning so the rest of the update carries on.
 */
export const syncHerdrMachines = Effect.gen(function* () {
  const log = yield* OutputLog;
  const outcome = yield* applyHerdrMachines;

  return yield* Outcome.$match(outcome, {
    Missing: () => Effect.succeed(skip("Herdr machines skipped (no list)")),
    Unchanged: () => Effect.succeed(skip("Herdr machines already up to date")),
    Saved: (counts) =>
      log
        .section("Herdr Machines")
        .pipe(
          Effect.andThen(log.success(savedMessage(counts))),
          Effect.andThen(log.info(RECONNECT_HINT)),
          Effect.as<RecapEntry>(notable(savedMessage(counts))),
        ),
  });
}).pipe(
  Effect.catch((error) =>
    Effect.gen(function* () {
      const log = yield* OutputLog;

      yield* log.section("Herdr Machines");
      yield* log.warn(`Herdr machines not saved: ${error.message}`);

      return warn("Herdr machines not saved");
    }),
  ),
  Effect.withSpan("SetupHerdrMachines.sync"),
);
