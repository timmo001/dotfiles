import { hostname } from "node:os";
import { join } from "node:path";
import { Data, Effect, FileSystem, Option, Predicate, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
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

interface HerdrMachinesConfig extends Schema.Schema.Type<
  typeof HerdrMachinesConfig
> {}

const HcMachineList = Schema.fromJsonString(
  Schema.Struct({
    machines: Schema.Array(
      Schema.Struct({ name: Schema.String, target: Schema.String }),
    ),
  }),
);

const HcFailure = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.Struct({ kind: Schema.String, message: Schema.String }),
  }),
);

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

/** The private machine list, or null when this device has none. */
const readMachineList = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(HERDR_MACHINES_CONFIG_PATH))) return null;

  const config: HerdrMachinesConfig = yield* fs
    .readFileString(HERDR_MACHINES_CONFIG_PATH)
    .pipe(
      Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
      Effect.flatMap(Schema.decodeUnknownEffect(HerdrMachinesConfig)),
      failWith(HERDR_MACHINES_CONFIG_PATH),
    );

  return config;
});

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
  const config = yield* readMachineList;

  if (config === null) return Outcome.Missing();

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

/** hc's machine names: 1-32 of a-z, 0-9, -, _ and . ("[HA] SSH" is ha-ssh). */
const hcName = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

/**
 * How hc reaches a listed target. hc's install can't take a port on the
 * target, so an ssh:// URL with one goes through --via, the form hc lists.
 */
const hcTarget = (
  target: string,
): readonly [string] | readonly ["--via", string] => {
  const url = /^ssh:\/\/(?:([^@/]+)@)?([^:/]+)(?::(\d+))?\/?$/.exec(target);

  if (url === null) return [target];

  const [, user, host, port] = url;
  const destination = user ? `${user}@${host}` : `${host}`;

  return port ? ["--via", `ssh -p ${port} ${destination}`] : [destination];
};

const OFFLINE_PATTERN =
  /Could not resolve hostname|timed out|No route to host|Connection refused/;

type HcAdd = "added" | "offline" | "failed";

type HcOutcome = Data.TaggedEnum<{
  Skipped: { readonly reason: string };
  Synced: {
    readonly added: readonly string[];
    readonly offline: readonly string[];
    readonly failed: readonly string[];
  };
}>;

const HcOutcome = Data.taggedEnum<HcOutcome>();

/**
 * Add the listed machines hc doesn't have yet, by name or target, installing
 * hc on them where it's missing or too old. A machine that can't be reached
 * now, such as a sleeping laptop, is tried again next time.
 */
const applyHcMachines = Effect.gen(function* () {
  if (Bun.which("hc") === null) return HcOutcome.Skipped({ reason: "no hc" });

  const config = yield* readMachineList;

  if (config === null) return HcOutcome.Skipped({ reason: "no list" });

  const executor = yield* CommandExecutor;

  const known = yield* executor.run("hc", ["machine", "ls", "--json"]).pipe(
    Effect.flatMap(Schema.decodeEffect(HcMachineList)),
    Effect.mapError(
      (cause) =>
        new SetupHerdrMachinesError({
          message: `hc machine ls: ${Predicate.isTagged(cause, "CommandError") ? cause.stderr : cause.message}`,
        }),
    ),
  );

  const localHost = hostname();

  const pending = config.machines
    .filter((machine) => machine.host !== localHost)
    .map((machine) => ({
      name: hcName(machine.label),
      reach: hcTarget(machine.target),
      session: machine.session,
    }))
    .filter(
      ({ name, reach }) =>
        !known.machines.some(
          (entry) => entry.name === name || entry.target === reach.at(-1),
        ),
    );

  const results = yield* Effect.forEach(pending, ({ name, reach, session }) =>
    executor
      .run("hc", [
        "machine",
        "add",
        ...reach,
        "--name",
        name,
        ...(session === undefined ? [] : ["--session", session]),
        "--install",
        "--json",
      ])
      .pipe(
        Effect.as<HcAdd>("added"),
        Effect.timeoutOrElse({
          duration: "2 minutes",
          orElse: () => Effect.succeed<HcAdd>("offline"),
        }),
        Effect.catchTag("CommandError", (error) =>
          Effect.succeed(
            Option.match(Schema.decodeOption(HcFailure)(error.stderr), {
              onNone: (): HcAdd => "failed",
              onSome: ({ error: failure }): HcAdd =>
                failure.kind === "unreachable" ||
                OFFLINE_PATTERN.test(failure.message)
                  ? "offline"
                  : "failed",
            }),
          ),
        ),
        Effect.map((result) => ({ name, result })),
      ),
  );

  const named = (result: HcAdd) =>
    results.filter((entry) => entry.result === result).map(({ name }) => name);

  return HcOutcome.Synced({
    added: named("added"),
    offline: named("offline"),
    failed: named("failed"),
  });
}).pipe(Effect.withSpan("SetupHerdrMachines.applyHc"));

const hcMessages = ({
  added,
  offline,
  failed,
}: {
  readonly added: readonly string[];
  readonly offline: readonly string[];
  readonly failed: readonly string[];
}) => ({
  added:
    added.length > 0
      ? `Added ${plural(added.length, "hc machine")}: ${added.join(", ")}`
      : null,
  offline:
    offline.length > 0
      ? `Not reachable now, tried again next time: ${offline.join(", ")}`
      : null,
  failed:
    failed.length > 0
      ? `hc couldn't add ${failed.join(", ")}; run hc machine add for the reason`
      : null,
});

/** Log the hc outcome; `quiet` leaves out what needs no attention, for dot update. */
const reportHcMachines = (outcome: HcOutcome, quiet: boolean) =>
  Effect.gen(function* () {
    const log = yield* OutputLog;

    return yield* HcOutcome.$match(outcome, {
      Skipped: ({ reason }) =>
        Effect.gen(function* () {
          if (!quiet) yield* log.info(`hc machines skipped (${reason})`);

          return skip(`hc machines skipped (${reason})`);
        }),
      Synced: (counts) =>
        Effect.gen(function* () {
          const messages = hcMessages(counts);

          if (messages.added === null && messages.failed === null) {
            if (!quiet) {
              yield* log.info("hc already has every machine it can reach");

              if (messages.offline !== null) yield* log.info(messages.offline);
            }

            return skip("hc machines already up to date");
          }

          if (quiet) yield* log.section("hc Machines");

          if (messages.added !== null) yield* log.success(messages.added);

          if (messages.offline !== null) yield* log.info(messages.offline);

          if (messages.failed !== null) {
            yield* log.warn(messages.failed);

            return warn("hc machines not all added");
          }

          return notable(messages.added ?? "hc machines added");
        }),
    });
  });

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

  yield* log.section("hc Machines");
  yield* reportHcMachines(yield* applyHcMachines, false);
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

/**
 * The `dot update` step for the Herdr app's core: it only shows up when it
 * adds machines or one fails, and a failure becomes a warning.
 */
export const syncHcMachines = applyHcMachines.pipe(
  Effect.flatMap((outcome) => reportHcMachines(outcome, true)),
  Effect.catch((error) =>
    Effect.gen(function* () {
      const log = yield* OutputLog;

      yield* log.section("hc Machines");
      yield* log.warn(`hc machines not added: ${error.message}`);

      return warn("hc machines not added");
    }),
  ),
  Effect.withSpan("SetupHerdrMachines.syncHc"),
);
