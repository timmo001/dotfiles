/**
 * @file Makes dot System Bridge's services provider. System Bridge only takes
 * providers from its settings file, never from a client, since they're
 * arbitrary commands, so `dot stow` writes dot's entry there.
 */
import { dirname, join } from "node:path";
import { Effect, FileSystem, Option, Schema } from "effect";
import { ENV, envString } from "./env.js";
import { DATA_DIR, HOME_DIR, displayPath } from "./paths.js";
import { notable, skip, warn } from "./updateSummary.js";

/** System Bridge's settings file, where its own `utils.GetConfigPath` puts it. */
const SETTINGS_FILE = join(
  envString(ENV.SYSTEM_BRIDGE_CONFIG_DIR) ??
    join(DATA_DIR, "system-bridge", "v5"),
  "settings.json",
);

const Provider = Schema.Struct({
  id: Schema.String,
  list: Schema.optional(Schema.Array(Schema.String)),
  act: Schema.optional(Schema.Array(Schema.String)),
});

const Settings = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown),
);

const decodeSettings = Schema.decodeOption(Settings);

const decodeRecord = Schema.decodeUnknownOption(
  Schema.Record(Schema.String, Schema.Unknown),
);

const decodeServices = Schema.decodeUnknownOption(
  Schema.Struct({ providers: Schema.optional(Schema.Array(Provider)) }),
);

/**
 * The full path, since System Bridge runs as a service whose PATH can be
 * shorter than a shell's.
 */
const DOT = join(HOME_DIR, ".local", "bin", "dot");

const DOT_PROVIDER = {
  id: "dot",
  list: [DOT, "services", "export"],
  act: [DOT, "services", "act"],
};

const sameCommand = (a: readonly string[] | undefined, b: readonly string[]) =>
  a !== undefined &&
  a.length === b.length &&
  a.every((part, i) => part === b[i]);

/**
 * What System Bridge's settings need: the settings to write when the `dot`
 * entry is missing or wrong, otherwise the recap line saying why not.
 */
const providerPlan = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(SETTINGS_FILE)))
    return {
      kind: "done",
      done: skip("System Bridge isn't set up here"),
    } as const;

  const text = yield* fs.readFileString(SETTINGS_FILE);
  const settings = decodeSettings(text);

  if (Option.isNone(settings))
    return {
      kind: "done",
      done: warn(
        `Left ${displayPath(SETTINGS_FILE)} alone: it isn't a JSON object`,
      ),
    } as const;

  const current = settings.value.services;
  const services = Option.getOrUndefined(decodeServices(current ?? {}));

  if (current != null && services === undefined)
    return {
      kind: "done",
      done: warn(
        `Left ${displayPath(SETTINGS_FILE)} alone: its services setting isn't one dot understands`,
      ),
    } as const;

  const providers = services?.providers ?? [];
  const existing = providers.find(({ id }) => id === DOT_PROVIDER.id);

  if (
    existing &&
    sameCommand(existing.list, DOT_PROVIDER.list) &&
    sameCommand(existing.act, DOT_PROVIDER.act)
  )
    return {
      kind: "done",
      done: skip("System Bridge already reads dot's services"),
    } as const;

  return {
    kind: "write",
    next: {
      ...settings.value,
      services: {
        ...Option.getOrElse(decodeRecord(current), () => ({})),
        providers: [
          ...providers.filter(({ id }) => id !== DOT_PROVIDER.id),
          DOT_PROVIDER,
        ],
      },
    },
  } as const;
}).pipe(Effect.withSpan("SystemBridge.providerPlan"));

/**
 * Whether `dot stow` would write the `dot` entry, so `dot up` runs the stow
 * stage on a machine whose System Bridge doesn't read dot's services yet.
 */
export const systemBridgeProviderNeedsApply = providerPlan.pipe(
  Effect.map((plan) => plan.kind === "write"),
  Effect.orElseSucceed(() => false),
);

/**
 * Add or correct the `dot` entry in System Bridge's `services.providers`,
 * keeping every other setting and provider. Leaves the file alone when the
 * entry is already right, when System Bridge isn't set up, or when the file
 * doesn't parse.
 */
export const syncSystemBridgeProvider = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const plan = yield* providerPlan;

  if (plan.kind === "done") return plan.done;

  const { next } = plan;

  // Write beside it and rename, keeping its mode, so System Bridge never
  // reads half a file.
  const mode = (yield* fs.stat(SETTINGS_FILE)).mode & 0o777;
  const temporary = join(dirname(SETTINGS_FILE), ".settings.json.dot");

  yield* fs.writeFileString(temporary, `${JSON.stringify(next, null, 2)}\n`, {
    mode,
  });
  yield* fs.chmod(temporary, mode);
  yield* fs.rename(temporary, SETTINGS_FILE);

  return notable("Set dot as System Bridge's services provider");
}).pipe(
  Effect.catch((error) =>
    Effect.succeed(
      warn(`Could not set System Bridge's services provider: ${error.message}`),
    ),
  ),
  Effect.withSpan("SystemBridge.syncProvider"),
);
