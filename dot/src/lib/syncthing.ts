import { join } from "node:path";
import { Effect, FileSystem, Schedule, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { cliStyler } from "./ansi.js";
import { CONFIG_DIR, displayPath, expandHomePath } from "./paths.js";
import { plural } from "./runSummary.js";
import { done, skip, warn } from "./updateSummary.js";
import type { RecapEntry } from "./updateSummary.js";

/** Syncthing user unit shipped by the Arch package. */
export const SYNCTHING_UNIT = "syncthing.service";

/** Desired Syncthing setup, stowed from the private overlay. */
export const SYNCTHING_CONFIG_PATH = join(CONFIG_DIR, "dot", "syncthing.yml");

const DeviceId = Schema.String.check(
  Schema.isPattern(/^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$/),
);

const SyncthingDevice = Schema.Struct({
  id: DeviceId,
  addresses: Schema.optionalKey(Schema.Array(Schema.String)),
});

const DeviceAddresses = Schema.fromJsonString(
  Schema.Struct({ addresses: Schema.Array(Schema.String) }),
);

const SyncthingFolder = Schema.Struct({
  label: Schema.optionalKey(Schema.String),
  path: Schema.String,
  devices: Schema.Array(Schema.String),
});

/** Devices and folders keyed by name and folder ID. */
export const SyncthingConfig = Schema.Struct({
  devices: Schema.Record(Schema.String, SyncthingDevice),
  folders: Schema.Record(Schema.String, SyncthingFolder),
});

/** Decoded {@link SyncthingConfig}. */
export interface SyncthingConfig extends Schema.Schema.Type<
  typeof SyncthingConfig
> {}

/** Failure to read the config or to apply it through `syncthing cli`. */
export class SyncthingError extends Schema.TaggedError<SyncthingError>()(
  "SyncthingError",
  { message: Schema.String },
) {}

/** Read the desired setup, or `null` when this machine has none. */
export const readSyncthingConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(SYNCTHING_CONFIG_PATH))) return null;

  const config = yield* fs.readFileString(SYNCTHING_CONFIG_PATH).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(SyncthingConfig)),
    Effect.mapError(
      (cause) =>
        new SyncthingError({
          message: `read ${displayPath(SYNCTHING_CONFIG_PATH)}: ${cause.message}`,
        }),
    ),
  );

  for (const [id, folder] of Object.entries(config.folders))
    for (const device of folder.devices)
      if (!(device in config.devices))
        return yield* new SyncthingError({
          message: `Folder ${id} lists unknown device ${device}`,
        });

  return config;
}).pipe(Effect.withSpan("Syncthing.readConfig"));

const cli = Effect.fn("Syncthing.cli")(function* (args: readonly string[]) {
  const executor = yield* CommandExecutor;

  return yield* executor
    .run("syncthing", ["cli", "config", ...args])
    .pipe(
      Effect.mapError(
        (cause) => new SyncthingError({ message: cause.message }),
      ),
    );
});

const listKeys = (args: readonly string[]) =>
  Effect.map(
    cli([...args, "list"]),
    (output) =>
      new Set(
        output
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      ),
  );

const ensureServiceRunning = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  if (
    (yield* executor.exitCode("systemctl", [
      "--user",
      "is-enabled",
      "--quiet",
      SYNCTHING_UNIT,
    ])) === 0 &&
    (yield* executor.exitCode("systemctl", [
      "--user",
      "is-active",
      "--quiet",
      SYNCTHING_UNIT,
    ])) === 0
  )
    return;

  yield* executor
    .run("systemctl", ["--user", "enable", "--now", SYNCTHING_UNIT])
    .pipe(
      Effect.mapError(
        (cause) => new SyncthingError({ message: cause.message }),
      ),
    );

  yield* log.success(`Enabled ${cliStyler().accent(SYNCTHING_UNIT)}`);
}).pipe(Effect.withSpan("Syncthing.ensureServiceRunning"));

/**
 * Apply the private Syncthing setup through `syncthing cli`.
 *
 * Enables the user service, then adds missing devices, folders and folder
 * shares, and turns off usage reporting. It never removes anything, so devices
 * and folders added in the Syncthing UI are kept. Syncthing keeps owning its
 * own `config.xml`, keys and API key.
 *
 * @returns Recap entries for the stow summary. Failures become a warning so a
 *   Syncthing problem never stops the rest of stow.
 */
export const applySyncthingConfig = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const log = yield* OutputLog;
  const style = cliStyler();

  const config = yield* readSyncthingConfig;

  if (!config) return [skip("Syncthing not configured")];

  yield* log.section("Syncthing");

  if ((yield* executor.exitCode("which", ["syncthing"])) !== 0) {
    yield* log.warn("syncthing is not installed; run dot init to install it");

    return [warn("Syncthing skipped (not installed)")];
  }

  yield* ensureServiceRunning;

  // The CLI talks to the running service, which takes a moment after start.
  const devices = yield* listKeys(["devices"]).pipe(
    Effect.retry({ times: 15, schedule: Schedule.spaced("1 second") }),
  );

  let added = 0;

  for (const [name, device] of Object.entries(config.devices)) {
    if (!devices.has(device.id)) {
      yield* cli(["devices", "add", "--device-id", device.id, "--name", name]);
      yield* log.success(`Added device ${style.accent(name)}`);
      added++;
    }

    if (!device.addresses) continue;

    const current = yield* cli(["devices", device.id, "dump-json"]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(DeviceAddresses)),
      Effect.mapError(
        (cause) =>
          new SyncthingError({
            message: `read ${name} addresses: ${cause.message}`,
          }),
      ),
    );

    for (const address of device.addresses) {
      if (current.addresses.includes(address)) continue;

      yield* cli(["devices", device.id, "addresses", "add", address]);
      yield* log.success(
        `Added address ${style.dim(address)} to ${style.accent(name)}`,
      );
      added++;
    }
  }

  if ((yield* cli(["options", "uraccepted", "get"])).trim() !== "-1")
    yield* cli(["options", "uraccepted", "set", "--", "-1"]);

  const folders = yield* listKeys(["folders"]);

  for (const [id, folder] of Object.entries(config.folders)) {
    const path = expandHomePath(folder.path);

    if (!folders.has(id)) {
      yield* fs.makeDirectory(path, { recursive: true });
      yield* cli([
        "folders",
        "add",
        "--id",
        id,
        "--label",
        folder.label ?? id,
        "--path",
        path,
      ]);
      yield* log.success(
        `Added folder ${style.accent(id)} ${style.dim(displayPath(path))}`,
      );
      added++;
    }

    const shared = yield* listKeys(["folders", id, "devices"]);

    for (const name of folder.devices) {
      const { id: deviceId } = config.devices[name] ?? {};

      if (!deviceId || shared.has(deviceId)) continue;

      yield* cli(["folders", id, "devices", "add", "--device-id", deviceId]);
      yield* log.success(
        `Shared folder ${style.accent(id)} with ${style.accent(name)}`,
      );
      added++;
    }
  }

  if (added === 0) {
    yield* log.success("Syncthing config up to date");

    return [skip("Syncthing config unchanged")];
  }

  return [done(`Applied ${plural(added, "Syncthing change")}`)];
}).pipe(
  Effect.catch((error) =>
    Effect.gen(function* () {
      const log = yield* OutputLog;

      yield* log.warn(`Syncthing config not applied: ${error.message}`);

      return [warn("Syncthing config not applied")] satisfies RecapEntry[];
    }),
  ),
  Effect.withSpan("Syncthing.applyConfig"),
);
