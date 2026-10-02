import { Effect, FileSystem, type PlatformError } from "effect";
import { basename, dirname, join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { LauncherError } from "../services/Launcher.js";
import { lstatOrNull, pathExists, readTextOrNull } from "./fsProbe.js";
import { parseManagedPlugins } from "./omarchyShellConfig.js";
import { decodeJson } from "./schema.js";

/** Discover real plugin submodule directories in the Omarchy stow package. */
export const omarchyPluginSubmodules = Effect.fn("OmarchyPlugin.submodules")(
  function* (repo: string) {
    const fs = yield* FileSystem.FileSystem;
    const directory = join(repo, "omarchy/.config/omarchy/plugins");

    if (!(yield* pathExists(directory))) return [];

    const names = yield* fs.readDirectory(directory);
    const sources: string[] = [];

    for (const name of names) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..")) {
        continue;
      }

      const source = join(directory, name);

      if ((yield* lstatOrNull(source))?.type !== "Directory") continue;

      if ((yield* lstatOrNull(join(source, ".git")))?.type === "File") {
        sources.push(source);
      }
    }

    return sources;
  },
);

/**
 * Resolve the plugin directory inside each managed checkout from the repo's
 * own registry. Checkouts without a `path` entry hold the plugin at their root.
 */
export const omarchyPluginSourcePaths = Effect.fn("OmarchyPlugin.sourcePaths")(
  function* (repo: string) {
    const registryPath = join(repo, "omarchy-plugins.json");
    const text = yield* readTextOrNull(registryPath);

    if (text === null) return new Map<string, string>();

    const registry = (() => {
      try {
        return parseManagedPlugins(decodeJson(JSON.parse(text)));
      } catch {
        return null;
      }
    })();

    if (!registry) {
      return yield* new LauncherError({
        message: `Invalid managed plugin registry: ${registryPath}`,
        exitCode: 1,
      });
    }

    return new Map(
      registry.plugins.flatMap(({ id, path }): [string, string][] =>
        path ? [[id, path]] : [],
      ),
    );
  },
);

const sameFiles = Effect.fn("OmarchyPlugin.sameFiles")(function* (
  source: string,
  target: string,
): Effect.fn.Return<
  boolean,
  PlatformError.PlatformError,
  FileSystem.FileSystem
> {
  const fs = yield* FileSystem.FileSystem;
  const expected = yield* lstatOrNull(source);
  const actual = yield* lstatOrNull(target);

  if (
    !expected ||
    !actual ||
    expected.type === "SymbolicLink" ||
    actual.type === "SymbolicLink"
  ) {
    return false;
  }

  if (expected.type === "Directory" && actual.type === "Directory") {
    const names = (yield* fs.readDirectory(source))
      .filter((name) => name !== ".git")
      .sort();

    const targets = (yield* fs.readDirectory(target)).sort();

    if (names.length !== targets.length) return false;

    for (const [index, name] of names.entries()) {
      if (name !== targets[index]) return false;

      if (!(yield* sameFiles(join(source, name), join(target, name)))) {
        return false;
      }
    }

    return true;
  }

  if (
    expected.type !== "File" ||
    actual.type !== "File" ||
    (expected.mode & 0o777) !== (actual.mode & 0o777)
  ) {
    return false;
  }

  const sourceBytes = yield* fs.readFile(source);
  const targetBytes = yield* fs.readFile(target);

  return Buffer.from(sourceBytes).equals(Buffer.from(targetBytes));
});

/** Copy and validate a plugin before replacing its live files, retaining a backup. */
export const deployOmarchyPlugin = Effect.fn("deployOmarchyPlugin")(function* (
  source: string,
  target: string,
  repo: string,
) {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;

  const filesystem = <A, R>(
    action: Effect.Effect<A, PlatformError.PlatformError, R>,
  ) =>
    action.pipe(
      Effect.mapError(
        (error) =>
          new LauncherError({
            message: `Could not deploy ${basename(target)}: ${String(error)}`,
            exitCode: 1,
          }),
      ),
    );

  // Validate even unchanged sources, and never copy development symlinks.
  yield* executor.run("omarchy-plugin-validate", [source]);

  if (yield* filesystem(sameFiles(source, target))) return null;

  const stage = yield* Effect.acquireRelease(
    filesystem(
      Effect.gen(function* () {
        yield* fs.makeDirectory(dirname(target), { recursive: true });

        return yield* fs.makeTempDirectory({
          directory: dirname(target),
          prefix: ".dot-plugin-",
        });
      }),
    ),
    (directory) =>
      fs
        .remove(directory, { recursive: true, force: true })
        .pipe(Effect.ignore),
  );

  yield* filesystem(
    Effect.gen(function* () {
      yield* fs.copy(source, stage, { overwrite: true });
      yield* fs.remove(join(stage, ".git"), { recursive: true, force: true });
    }),
  );
  yield* executor.run("omarchy-plugin-validate", [stage]);

  return yield* filesystem(
    Effect.gen(function* () {
      let backup: string | null = null;

      if (yield* lstatOrNull(target)) {
        const backups = join(repo, "backup/omarchy-plugins");
        yield* fs.makeDirectory(backups, { recursive: true });
        backup = join(
          yield* fs.makeTempDirectory({
            directory: backups,
            prefix: `${basename(target)}-`,
          }),
          "plugin",
        );
        yield* fs.rename(target, backup);
      }

      yield* fs
        .rename(stage, target)
        .pipe(
          Effect.tapError(() =>
            backup
              ? fs.rename(backup, target).pipe(Effect.ignore)
              : Effect.void,
          ),
        );

      return { target, backup };
    }),
  );
}, Effect.scoped);
