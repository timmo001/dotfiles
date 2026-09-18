import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Predicate,
  Record,
  Schema,
} from "effect";
import { join } from "node:path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { DependencyConfigError, RenovateObject } from "./config.js";

const Runtime = Schema.Struct({
  tools: Schema.Struct({ node: Schema.String, "npm:renovate": Schema.String }),
});

const Export = Schema.Struct({
  msg: Schema.String,
  config: Schema.optionalKey(RenovateObject),
});

/** Resolver output before native policy translation. */
export interface ResolvedRenovate {
  /** Installed resolver version associated with the export. */
  readonly version: string;
  /** Uncustomised resolver defaults used to identify preset changes. */
  readonly defaults: RenovateObject;
  /** Resolved one-off preset policy. */
  readonly base: RenovateObject;
  /** Fully resolved repository policy used to check conversion semantics. */
  readonly full: RenovateObject;
}

/** Authority to run the import-only resolver in an owned temporary checkout. */
export interface RenovateResolverService {
  /** Export policy without modifying the caller's checkout or publishing anything. */
  readonly resolve: (
    root: string,
    source: RenovateObject,
    timeout: number,
  ) => Effect.Effect<ResolvedRenovate, DependencyConfigError>;
}

/** Import-only process and temporary-checkout lifecycle for {@link RenovateResolverService}. */
export class RenovateResolver extends Context.Service<
  RenovateResolver,
  RenovateResolverService
>()("dot/Dependencies/RenovateResolver") {
  /** Build the resolver from the application's filesystem and command services. */
  static readonly layer = Layer.effect(
    RenovateResolver,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const executor = yield* CommandExecutor;
      const config = yield* Config;
      const log = yield* OutputLog;

      return RenovateResolver.of({
        resolve: Effect.fn("RenovateResolver.resolve")(
          function* (root, source, timeout) {
            const imports = join(config.cacheDir, "deps-import");
            yield* fs.makeDirectory(imports, { recursive: true });

            const temporary = yield* fs.makeTempDirectoryScoped({
              directory: imports,
              prefix: "import-",
            });

            const snapshot = join(temporary, "source");

            const run = Effect.fn("RenovateResolver.run")(function* (
              command: string,
              args: readonly string[],
              cwd: string,
              env?: Readonly<Record<string, string>>,
            ) {
              return yield* executor.run(
                "dot",
                [
                  "run",
                  "--timeout",
                  `${timeout} millis`,
                  "--",
                  command,
                  ...args,
                ],
                { cwd, env },
              );
            });

            yield* run(
              "git",
              [
                "clone",
                "--shared",
                "--no-hardlinks",
                "--quiet",
                "--",
                root,
                snapshot,
              ],
              root,
            );

            // Replace a checked-out symlink rather than writing through it.
            yield* fs.remove(join(snapshot, "renovate.json"), { force: true });

            const runtimeText = yield* fs.readFileString(
              join(config.publicDotfiles, "dot", "deps-import", "mise.toml"),
            );

            const runtime = yield* Effect.try(() =>
              Bun.TOML.parse(runtimeText),
            ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Runtime)));

            const global = join(temporary, "global.json");
            yield* fs.writeFileString(global, "{}");

            const exportConfig = Effect.fn("RenovateResolver.export")(
              function* (label: string, value: RenovateObject) {
                yield* fs.writeFileString(
                  join(snapshot, "renovate.json"),
                  JSON.stringify(value),
                );
                yield* log.info(`[IMPORT] Resolving ${label}`);

                const text = yield* run(
                  "mise",
                  [
                    "exec",
                    `node@${runtime.tools.node}`,
                    `npm:renovate@${runtime.tools["npm:renovate"]}`,
                    "--",
                    "renovate",
                    "--platform=local",
                    "--dry-run=extract",
                    "--onboarding=false",
                    "--require-config=required",
                  ],
                  snapshot,
                  {
                    LOG_FORMAT: "json",
                    RENOVATE_PRINT_CONFIG: "true",
                    RENOVATE_CONFIG_FILE: global,
                    RENOVATE_CONFIG: "{}",
                    RENOVATE_REPOSITORY_CACHE: "disabled",
                  },
                );

                const events = yield* Effect.forEach(
                  text.split("\n").filter((line) => line.startsWith("{")),
                  (line) =>
                    Schema.decodeEffect(Schema.fromJsonString(Export))(line),
                );

                const configs = events
                  .filter(
                    (event) =>
                      event.msg ===
                      "Full resolved config and hostRules including presets",
                  )
                  .flatMap((event) => (event.config ? [event.config] : []));

                if (configs.length !== 1 || !configs[0])
                  return yield* new DependencyConfigError({
                    message: `Expected one resolved configuration for ${label}`,
                  });

                return configs[0];
              },
            );

            const defaults = yield* exportConfig("defaults", {});

            const base = yield* exportConfig("presets", {
              ...Record.filter(
                {
                  extends: source.extends,
                  ignorePresets: source.ignorePresets,
                },
                Predicate.isNotUndefined,
              ),
            });

            const full = yield* exportConfig("repository overrides", source);

            return {
              version: runtime.tools["npm:renovate"],
              defaults,
              base,
              full,
            };
          },
          Effect.scoped,
          Effect.mapError(
            () =>
              new DependencyConfigError({
                message:
                  "Renovate export failed. Check the JSON config and the runtime in dot/deps-import/mise.toml. Resolver output is withheld because it may contain credentials.",
              }),
          ),
        ),
      });
    }),
  );
}
