import { Effect, FileSystem, type PlatformError } from "effect";
import { basename, dirname, join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { managedGitRepoForGitHub } from "../services/GitConfig.js";
import { LauncherError } from "../services/Launcher.js";
import { lstatOrNull, pathExists, readTextOrNull } from "./fsProbe.js";
import { HOME_DIR } from "./paths.js";
import {
  parseManagedPlugins,
  type ManagedPlugin,
} from "./omarchyShellConfig.js";
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
 * Read the plugin entries of a repository's own registry, which say where each
 * managed plugin's files come from. A repository without a registry has none.
 */
export const managedOmarchyPlugins = Effect.fn("OmarchyPlugin.registry")(
  function* (repo: string) {
    const registryPath = join(repo, "omarchy-plugins.json");
    const text = yield* readTextOrNull(registryPath);
    const none: readonly ManagedPlugin[] = [];

    if (text === null) return none;

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

    return registry.plugins;
  },
);

/**
 * Find the local checkout of a tracked repository by its GitHub slug.
 *
 * @returns The checkout path, or `null` when the repository isn't tracked in
 * the private git config or isn't cloned on this machine.
 */
export const trackedPluginCheckout = Effect.fn("OmarchyPlugin.trackedCheckout")(
  function* (github: string) {
    const config = yield* Config;
    const repo = managedGitRepoForGitHub(config.gitConfig, github);

    return repo && (yield* pathExists(join(repo.path, ".git")))
      ? repo.path
      : null;
  },
);

/** A tracked checkout's remote default branch, such as `origin/main`. */
export const trackedPluginBranch = Effect.fn("OmarchyPlugin.trackedBranch")(
  function* (checkout: string) {
    const executor = yield* CommandExecutor;

    return (yield* executor.run(
      "git",
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      { cwd: checkout },
    )).trim();
  },
);

/** Plugin files exported from a tracked repository's remote default branch. */
export interface ExportedOmarchyPlugin {
  /** Directory holding the exported plugin files. */
  readonly files: string;
  /** Remote branch the files came from, such as `origin/main`. */
  readonly ref: string;
  /** Commit the files came from. */
  readonly sha: string;
}

/**
 * Export a plugin from a tracked checkout's remote default branch, as last
 * fetched, into a temporary directory removed when the caller's scope closes.
 * Only the branch's committed files are exported, never the working tree, so
 * ignored build output, local edits and feature branches stay off the bar.
 */
export const exportTrackedPlugin = Effect.fn("OmarchyPlugin.exportTracked")(
  function* (checkout: string, path: string | undefined) {
    const executor = yield* CommandExecutor;
    const fs = yield* FileSystem.FileSystem;
    const ref = yield* trackedPluginBranch(checkout);

    const sha = (yield* executor.run(
      "git",
      ["rev-parse", "--verify", `${ref}^{commit}`],
      { cwd: checkout },
    )).trim();

    const directory = yield* fs
      .makeTempDirectoryScoped({ prefix: "dot-plugin-" })
      .pipe(deploymentError(checkout));

    const archive = join(directory, "plugin.tar");
    const files = join(directory, "plugin");

    yield* fs.makeDirectory(files).pipe(deploymentError(checkout));
    yield* executor.run(
      "git",
      [
        "archive",
        "--format=tar",
        `--output=${archive}`,
        path ? `${sha}:${path}` : sha,
      ],
      { cwd: checkout },
    );
    yield* executor.run("tar", ["-xf", archive, "-C", files]);

    return { files, ref, sha } satisfies ExportedOmarchyPlugin;
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

/** Whether a plugin directory has anything to copy besides its git metadata. */
const hasPluginFiles = Effect.fn("OmarchyPlugin.hasFiles")(function* (
  source: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* lstatOrNull(source);

  if (info?.type !== "Directory") return false;

  return (yield* fs.readDirectory(source)).some((name) => name !== ".git");
});

/** Whether the exported or checked-out plugin differs from its live copy. */
const pluginDiffers = Effect.fn("OmarchyPlugin.differs")(function* (
  source: string,
  target: string,
) {
  if (!(yield* hasPluginFiles(source))) return false;

  return !(yield* sameFiles(source, target).pipe(
    Effect.orElseSucceed(() => false),
  ));
});

/**
 * Whether stow would replace a live Omarchy plugin.
 *
 * Submodule plugins are ignored by the stow plan, and tracked plugins are
 * copied from another repository, so neither shows up as a link change. An
 * empty checkout is left alone: copying it would replace the live plugin
 * with nothing. A tracked export that cannot be read is skipped.
 */
export const omarchyPluginsNeedDeploy = Effect.fn("OmarchyPlugin.needsDeploy")(
  function* (repo: string) {
    const registry = yield* managedOmarchyPlugins(repo);

    const tracked = registry.flatMap(({ id, repository, path }) =>
      repository ? [{ id, repository, path }] : [],
    );

    const trackedIds = new Set(tracked.map(({ id }) => id));
    const live = (id: string) => join(HOME_DIR, ".config/omarchy/plugins", id);

    for (const checkout of yield* omarchyPluginSubmodules(repo)) {
      const id = basename(checkout);

      if (trackedIds.has(id)) continue;

      const source = join(
        checkout,
        registry.find((entry) => entry.id === id)?.path ?? "",
      );

      if (yield* pluginDiffers(source, live(id))) return true;
    }

    for (const { id, repository, path } of tracked) {
      const checkout = yield* trackedPluginCheckout(repository);

      if (!checkout) continue;

      const differs = yield* Effect.scoped(
        Effect.gen(function* () {
          const exported = yield* exportTrackedPlugin(checkout, path);

          return yield* pluginDiffers(exported.files, live(id));
        }),
      ).pipe(Effect.orElseSucceed(() => false));

      if (differs) return true;
    }

    return false;
  },
);

/** A validated plugin copy staged beside the live plugin it replaces. */
export interface StagedOmarchyPlugin {
  /** Live plugin directory to replace. */
  readonly target: string;
  /** Hidden staging directory holding the validated copy. */
  readonly stage: string;
}

/** Map a filesystem failure to a deployment error naming the plugin. */
const deploymentError =
  (target: string) =>
  <A, R>(action: Effect.Effect<A, PlatformError.PlatformError, R>) =>
    action.pipe(
      Effect.mapError(
        (error) =>
          new LauncherError({
            message: `Could not deploy ${basename(target)}: ${String(error)}`,
            exitCode: 1,
          }),
      ),
    );

/**
 * Validate a plugin and, when it differs from the live copy, stage a
 * validated copy beside it. The staging directory is hidden, so the shell's
 * plugin watcher ignores it, and it is removed when the caller's scope closes.
 *
 * @returns The staged copy, or `null` when the live plugin is already current.
 */
export const stageOmarchyPlugin = Effect.fn("stageOmarchyPlugin")(function* (
  source: string,
  target: string,
) {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const filesystem = deploymentError(target);

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

  return { target, stage } satisfies StagedOmarchyPlugin;
});

/** Swap a staged plugin into place, moving the previous copy to a backup. */
export const swapOmarchyPlugin = Effect.fn("swapOmarchyPlugin")(function* (
  { target, stage }: StagedOmarchyPlugin,
  repo: string,
) {
  const fs = yield* FileSystem.FileSystem;

  return yield* deploymentError(target)(
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
});

/** Copy and validate a plugin before replacing its live files, retaining a backup. */
export const deployOmarchyPlugin = Effect.fn("deployOmarchyPlugin")(function* (
  source: string,
  target: string,
  repo: string,
) {
  const staged = yield* stageOmarchyPlugin(source, target);

  return staged ? yield* swapOmarchyPlugin(staged, repo) : null;
}, Effect.scoped);
