import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { CONFIG_DIR, displayPath, expandHomePath } from "../lib/paths.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";

const ComponentName = Schema.String.check(
  Schema.isPattern(/^[A-Z][A-Za-z0-9]*$/),
);

const ComponentsConfig = Schema.Struct({
  targets: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      components: Schema.NonEmptyArray(ComponentName),
    }),
  ),
});

/** Domain error raised when shared Omarchy components cannot be synced. */
export class OmarchyComponentsError extends Schema.TaggedError<OmarchyComponentsError>()(
  "OmarchyComponentsError",
  { message: Schema.String },
) {}

/**
 * Copy the shared Omarchy panel components from the public dotfiles source
 * into each standalone plugin checkout listed in the private config.
 * With `check`, report drift without writing and fail when any is found.
 */
export const syncOmarchyComponents = Effect.fn("syncOmarchyComponents")(
  function* (options: { readonly check: boolean; readonly config: string }) {
    const fs = yield* FileSystem.FileSystem;
    const output = yield* OutputLog;
    const { publicDotfiles } = yield* Config;

    const source = join(
      process.env.DOTFILES_REPO ?? publicDotfiles,
      "omarchy",
      ".config",
      "omarchy",
      "components",
    );

    const file = expandHomePath(
      options.config || join(CONFIG_DIR, "dot", "omarchy-components.json"),
    );

    if (!(yield* fs.exists(file))) {
      yield* output.info(
        `No component targets configured: ${displayPath(file)}`,
      );

      return;
    }

    const config = yield* Schema.decodeEffect(
      Schema.fromJsonString(ComponentsConfig),
    )(yield* fs.readFileString(file), { onExcessProperty: "error" });

    const drifted: string[] = [];

    for (const target of config.targets) {
      const directory = expandHomePath(target.path);

      if (!(yield* fs.exists(directory))) {
        yield* output.warn(`Target not found: ${displayPath(directory)}`);
        continue;
      }

      for (const component of target.components) {
        const sourceFile = join(source, `${component}.qml`);

        if (!(yield* fs.exists(sourceFile))) {
          return yield* new OmarchyComponentsError({
            message: `Shared component not found: ${displayPath(sourceFile)}`,
          });
        }

        const targetFile = join(directory, `${component}.qml`);
        const contents = yield* fs.readFileString(sourceFile);

        const current = (yield* fs.exists(targetFile))
          ? yield* fs.readFileString(targetFile)
          : undefined;

        if (current === contents) continue;

        drifted.push(displayPath(targetFile));

        if (options.check) {
          yield* output.warn(`Out of date: ${displayPath(targetFile)}`);
        } else {
          yield* fs.writeFileString(targetFile, contents);
          yield* output.success(
            `${current === undefined ? "Added" : "Updated"} ${displayPath(targetFile)}`,
          );
        }
      }
    }

    if (drifted.length === 0) {
      yield* output.info("Shared components are up to date");
    } else if (options.check) {
      yield* output.error(
        `${drifted.length} component copies are out of date; run dot omarchy-plugin sync-components`,
      );
      process.exitCode = 1;
    }
  },
);
