import { Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { formatJson } from "../mcp/sync/formatJson.js";
import { Config } from "../services/Config.js";
import { writeFileAtomic } from "./atomicWrite.js";
import { HOME_DIR } from "./paths.js";
import { runQuiet } from "./quietCommand.js";
import {
  decodeJsonObject,
  isJsonObject,
  isString,
  type JsonValue,
} from "./schema.js";

/** Failure while installing the shared OpenCode plugin dependencies. */
export class OpencodePluginInstallError extends Schema.TaggedError<OpencodePluginInstallError>()(
  "OpencodePluginInstallError",
  { message: Schema.String },
) {}

/**
 * Install the locked OpenCode plugin dependencies in the stow source.
 *
 * Stowed plugin files resolve imports from their symlink target, so the
 * dependencies must live beside the source rather than under `~/.config`.
 */
export const installOpencodePluginDependencies = Effect.gen(function* () {
  const config = yield* Config;

  const source = join(
    config.publicDotfiles,
    "agents",
    ".config",
    "opencode",
    "plugins",
  );

  const { exitCode: code } = yield* runQuiet(
    "bun",
    ["install", "--frozen-lockfile"],
    { cwd: source },
  );

  if (code !== 0) {
    return yield* new OpencodePluginInstallError({
      message: `Locked OpenCode plugin dependency install exited ${code}`,
    });
  }

  return source;
});

/** Plugins every machine loads from the global OpenCode config. */
export const GLOBAL_PLUGINS = [
  "github:timmo001/ha-bridge#main::path:packages/opencode",
  "github:timmo001/system-bridge#dev::path:opencode-plugin",
  "github:timmo001/triage#main::path:opencode-plugin",
  "github:timmo001/upnext#main::path:opencode-plugin",
  "github:timmo001/skills#main::path:opencode-plugin",
  "github:timmo001/notes#main::path:opencode-plugin",
  "github:timmo001/context#main::path:opencode-plugin",
  "github:timmo001/effect-gh#main::path:opencode-plugin",
  "github:timmo001/kestrel#main::path:opencode-plugin",
];

const CONFIG_PATH = join("agents", ".config", "opencode", "opencode.json");

/** A `plugins` entry's package spec, whether a string or `{ package }`. */
const pluginSpec = (entry: JsonValue) =>
  isString(entry)
    ? entry
    : isJsonObject(entry) && isString(entry.package)
      ? entry.package
      : null;

/**
 * Add the missing {@link GLOBAL_PLUGINS} to the global OpenCode config,
 * leaving every other entry alone.
 *
 * The global config is stowed from the private overlay, so the entries are
 * written into its source there, as `dot mcp sync` does; without the overlay
 * they go into the live file.
 */
export const ensureGlobalOpencodePlugins = Effect.gen(function* () {
  const config = yield* Config;
  const fs = yield* FileSystem.FileSystem;

  const path =
    config.canUsePrivate && config.privateDotfiles !== null
      ? join(config.privateDotfiles, CONFIG_PATH)
      : join(HOME_DIR, ".config", "opencode", "opencode.json");

  const existing = (yield* fs.exists(path))
    ? decodeJsonObject(JSON.parse(yield* fs.readFileString(path)))
    : {};

  const plugins = Schema.decodeUnknownSync(Schema.Array(Schema.Json))(
    existing.plugins ?? [],
  );

  const present = new Set(plugins.map(pluginSpec));
  const added = GLOBAL_PLUGINS.filter((spec) => !present.has(spec));

  if (added.length > 0) {
    yield* Effect.sync(() =>
      writeFileAtomic(
        path,
        formatJson({ ...existing, plugins: [...plugins, ...added] }),
        { createDirectory: true },
      ),
    );
  }

  return { path, added };
});
