import { Data, Duration, Effect, FileSystem, Schema, Stream } from "effect";
import { join } from "path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Config } from "../services/Config.js";
import { deployOmarchyPlugin } from "../lib/omarchyPluginDeployment.js";
import {
  isPluginPath,
  isRelativePluginPath,
} from "../lib/omarchyShellConfig.js";
import { gitRemoteOutput } from "../lib/git.js";
import {
  CommandExecutor,
  type CommandError,
} from "../services/CommandExecutor.js";
import {
  decodeJsonObject,
  isJsonObject,
  isString,
  type JsonObject,
  type JsonValue,
} from "../lib/schema.js";

/** Exit code telling Omarchy to handle a plugin outside the managed registry. */
export const UNMANAGED_PLUGIN_EXIT_CODE = 20;

/** Resolved paths used by the managed Omarchy plugin workflow. */
export interface OmarchyPluginPaths {
  /** Public dotfiles repository. */
  readonly repo: string;
  /** Managed plugin registry. */
  readonly registry: string;
  /** Managed plugin submodule directory. */
  readonly pluginsSource: string;
  /** Live Omarchy plugin directory. */
  readonly pluginsLive: string;
  /** Prettier executable used to format the registry. */
  readonly prettier: string;
}

/** Domain error raised by managed Omarchy plugin operations. */
export class OmarchyPluginError extends Schema.TaggedError<OmarchyPluginError>()(
  "OmarchyPluginError",
  { message: Schema.String },
) {}

interface Placement {
  readonly section: "left" | "center" | "right";
  readonly before?: string;
  readonly after?: string;
}

interface AddOptions {
  readonly id: string;
  readonly url: string;
  readonly checkout: string;
  readonly path?: string;
  readonly placement: Placement;
}

/** Typed input for managed Omarchy plugin operations. */
export type OmarchyPluginInput =
  | {
      readonly _tag: "add";
      readonly id: string;
      readonly url: string;
      readonly checkout: string;
      readonly path?: string;
      readonly section?: "left" | "center" | "right";
      readonly before?: string;
      readonly after?: string;
    }
  | { readonly _tag: "update"; readonly id?: string; readonly yes: boolean }
  | {
      readonly _tag: "remove";
      readonly id: string;
      readonly yes: boolean;
      readonly offerCommit: boolean;
    };

/** Constructors and guards for managed plugin operations. */
export const OmarchyPluginInput = Data.taggedEnum<OmarchyPluginInput>();

type PluginEffect = Effect.Effect<
  void,
  OmarchyPluginError | CommandError,
  | CommandExecutor
  | FileSystem.FileSystem
  | ChildProcessSpawner.ChildProcessSpawner
>;

function fail(message: string): Effect.Effect<never, OmarchyPluginError> {
  return Effect.fail(new OmarchyPluginError({ message }));
}

function validPluginId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes("..");
}

const pathExists = Effect.fn("OmarchyPlugin.pathExists")(function* (
  path: string,
) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readLink(path).pipe(
    Effect.as(true),
    Effect.catch(() => fs.exists(path)),
    Effect.orElseSucceed(() => false),
  );
});

function requirePluginId(
  id: string | undefined,
): Effect.Effect<string, OmarchyPluginError> {
  return id && validPluginId(id)
    ? Effect.succeed(id)
    : fail(`invalid plugin id '${id ?? ""}'`);
}

/** Convert GitHub SSH remotes to portable HTTPS submodule URLs. */
export function httpsGitUrl(url: string): string {
  if (url.startsWith("git@github.com:")) {
    return `https://github.com/${url.slice("git@github.com:".length)}`;
  }

  if (url.startsWith("ssh://git@github.com/")) {
    return `https://github.com/${url.slice("ssh://git@github.com/".length)}`;
  }

  return url;
}

function pluginEntries(registry: JsonObject): readonly JsonObject[] {
  const plugins = registry.plugins;

  if (!Array.isArray(plugins)) {
    throw new OmarchyPluginError({ message: "plugins must be an array" });
  }

  return plugins.map((plugin) => {
    if (!isJsonObject(plugin)) {
      throw new OmarchyPluginError({ message: "plugins must contain objects" });
    }

    return plugin;
  });
}

const readRegistry = Effect.fn("OmarchyPlugin.readRegistry")(function* (
  paths: OmarchyPluginPaths,
) {
  const fs = yield* FileSystem.FileSystem;

  const invalid = (detail: string) =>
    new OmarchyPluginError({
      message: `invalid managed plugin registry: ${paths.registry}: ${detail}`,
    });

  const text = yield* fs
    .readFileString(paths.registry)
    .pipe(Effect.mapError((error) => invalid(String(error))));

  return yield* Effect.try({
    try: () => {
      const registry = decodeJsonObject(JSON.parse(text));

      pluginEntries(registry);

      return registry;
    },
    catch: (error) =>
      error instanceof OmarchyPluginError ? error : invalid(String(error)),
  });
});

function managedPluginIds(paths: OmarchyPluginPaths) {
  return readRegistry(paths).pipe(
    Effect.map((registry) =>
      pluginEntries(registry).flatMap((plugin) =>
        plugin.managed === true && isString(plugin.id) ? [plugin.id] : [],
      ),
    ),
  );
}

function isManaged(paths: OmarchyPluginPaths, id: string) {
  return managedPluginIds(paths).pipe(Effect.map((ids) => ids.includes(id)));
}

/** Plugin directory for a managed checkout, honouring a registry `path`. */
function pluginSource(paths: OmarchyPluginPaths, id: string) {
  return readRegistry(paths).pipe(
    Effect.map((registry) => {
      const path = pluginEntries(registry).find(
        (plugin) => plugin.id === id,
      )?.path;

      return join(
        paths.pluginsSource,
        id,
        path !== undefined && isPluginPath(path) ? path : "",
      );
    }),
  );
}

function fsError(message: string) {
  return (error: { readonly message: string }) =>
    new OmarchyPluginError({ message: `${message}: ${error.message}` });
}

function commandFailure(command: string, exitCode: number) {
  return fail(`${command} exited ${exitCode}`);
}

function runInherited(command: string, args: readonly string[], cwd?: string) {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    const exitCode = yield* executor.inherit(
      command,
      args,
      cwd ? { cwd } : undefined,
    );

    if (exitCode !== 0) return yield* commandFailure(command, exitCode);
  });
}

function unstage(paths: OmarchyPluginPaths, id: string) {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    yield* executor.exitCode(
      "git",
      [
        "reset",
        "-q",
        "HEAD",
        "--",
        ".gitmodules",
        "omarchy-plugins.json",
        `omarchy/.config/omarchy/plugins/${id}`,
      ],
      { cwd: paths.repo },
    );
  });
}

function writeRegistry(paths: OmarchyPluginPaths, registry: JsonObject) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (
      !(yield* fs
        .exists(paths.prettier)
        .pipe(Effect.orElseSucceed(() => false)))
    ) {
      return yield* fail(`Prettier not found: ${paths.prettier}`);
    }

    const temporary = `${paths.registry}.tmp.${process.pid}`;

    yield* fs
      .writeFileString(temporary, `${JSON.stringify(registry)}\n`)
      .pipe(Effect.mapError(fsError(`could not write temporary registry`)));

    yield* Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      yield* executor
        .run(paths.prettier, ["--write", "--parser", "json", temporary])
        .pipe(
          Effect.mapError(
            (error) =>
              new OmarchyPluginError({
                message: error.stderr || error.message,
              }),
          ),
        );
      yield* fs
        .rename(temporary, paths.registry)
        .pipe(
          Effect.mapError(fsError(`could not replace managed plugin registry`)),
        );
    }).pipe(
      Effect.ensuring(
        fs.remove(temporary, { force: true }).pipe(Effect.ignore),
      ),
    );
  });
}

function restoreRegistry(paths: OmarchyPluginPaths, contents: string) {
  const temporary = `${paths.registry}.tmp.${process.pid}`;

  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* Effect.gen(function* () {
      yield* fs.writeFileString(temporary, contents);
      yield* fs.rename(temporary, paths.registry);
    }).pipe(
      Effect.ensuring(
        fs.remove(temporary, { force: true }).pipe(Effect.ignore),
      ),
      Effect.mapError(fsError("could not restore managed plugin registry")),
    );
  });
}

function removeLivePlugin(paths: OmarchyPluginPaths, id: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* fs
      .remove(join(paths.pluginsLive, id), { recursive: true, force: true })
      .pipe(Effect.mapError(fsError(`could not remove live plugin '${id}'`)));
  });
}

function rescanPlugins() {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    yield* executor
      .run("omarchy-shell", ["shell", "rescanPlugins"])
      .pipe(
        Effect.mapError(
          (error) =>
            new OmarchyPluginError({ message: error.stderr || error.message }),
        ),
      );
  });
}

function stowPublic() {
  return runInherited("dot", ["stow", "--public"]);
}

function interactive(): boolean {
  return (
    process.env.OMARCHY_PLUGIN_INTERACTIVE === "1" ||
    (process.stdin.isTTY === true && process.stdout.isTTY === true)
  );
}

function choose(header: string, choices: readonly string[]) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const proc = yield* spawner.spawn(
      ChildProcess.make(
        "gum",
        ["choose", `--header=${header}`, "--selected", "No", ...choices],
        { stdin: "ignore", stdout: "pipe", stderr: "inherit" },
      ),
    );

    const output = yield* proc.stdout.pipe(
      Stream.decodeText(),
      Stream.mkString,
    );

    return (yield* proc.exitCode) === 0 ? output.trim() : "";
  }).pipe(
    Effect.scoped,
    Effect.mapError(
      (error) =>
        new OmarchyPluginError({
          message: `could not open choice prompt: ${String(error)}`,
        }),
    ),
    Effect.orElseSucceed(() => ""),
  );
}

function confirm(message: string) {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    return (yield* executor.inherit("gum", ["confirm", message])) === 0;
  });
}

function offerCommit(
  paths: OmarchyPluginPaths,
  action: "add" | "remove",
  id: string,
  registryBeforeAdd?: string,
): PluginEffect {
  return Effect.gen(function* () {
    if (!interactive()) return;

    const choices =
      action === "add"
        ? ["Discard plugin", "No", "Commit", "Commit and push"]
        : ["No", "Commit", "Commit and push"];

    const choice = yield* choose("Save managed plugin changes?", choices);

    if (choice === "Discard plugin") {
      yield* removePlugin(paths, id, true, false);

      if (registryBeforeAdd !== undefined) {
        yield* restoreRegistry(paths, registryBeforeAdd);
        yield* unstage(paths, id);
      }

      return;
    }

    if (choice !== "Commit" && choice !== "Commit and push") return;

    const args = [
      "git-commit",
      "-m",
      `${action === "add" ? "Add" : "Remove"} ${id} Omarchy plugin`,
      "--path",
      ".gitmodules",
      "--path",
      "omarchy-plugins.json",
      "--path",
      `omarchy/.config/omarchy/plugins/${id}`,
    ];

    if (choice === "Commit and push") args.push("--push");
    yield* runInherited("dot", args, paths.repo);
  });
}

function parsePlacement(
  args: readonly string[],
  defaultSection: string,
): Effect.Effect<Placement, OmarchyPluginError> {
  let section = defaultSection;
  let before: string | undefined;
  let after: string | undefined;

  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];

    if (!value) return fail(`${option} requires a value`);

    if (option === "--section") section = value;
    else if (option === "--before") before = value;
    else if (option === "--after") after = value;
    else return fail(`unknown placement option: ${option}`);
  }

  if (section !== "left" && section !== "center" && section !== "right") {
    return fail(`invalid section: ${section}`);
  }

  if (before && after) return fail("use only one of --before or --after");

  return Effect.succeed({
    section,
    ...(before && { before }),
    ...(after && { after }),
  });
}

const manifestDefaultSection = Effect.fn(
  "OmarchyPlugin.manifestDefaultSection",
)(function* (checkout: string) {
  const fs = yield* FileSystem.FileSystem;

  const failure = (detail: string) =>
    new OmarchyPluginError({
      message: `could not read plugin manifest: ${detail}`,
    });

  const text = yield* fs
    .readFileString(join(checkout, "manifest.json"))
    .pipe(Effect.mapError((error) => failure(String(error))));

  return yield* Effect.try({
    try: () => {
      const manifest = decodeJsonObject(JSON.parse(text));

      const barWidget = manifest.barWidget;

      return isJsonObject(barWidget) && isString(barWidget.defaultSection)
        ? barWidget.defaultSection
        : "center";
    },
    catch: (error) => failure(String(error)),
  });
});

function addPlugin(paths: OmarchyPluginPaths, options: AddOptions) {
  return Effect.gen(function* () {
    const id = yield* requirePluginId(options.id);

    if (yield* pathExists(join(paths.pluginsSource, id))) {
      return yield* fail(`managed plugin '${id}' already exists`);
    }

    const executor = yield* CommandExecutor;

    const registryBeforeAdd = yield* (yield* FileSystem.FileSystem)
      .readFileString(paths.registry)
      .pipe(
        Effect.mapError(
          (error) =>
            new OmarchyPluginError({
              message: `could not read managed plugin registry: ${String(error)}`,
            }),
        ),
      );

    const sha = (yield* executor.run("git", ["rev-parse", "HEAD"], {
      cwd: options.checkout,
    })).trim();

    const currentBranch = yield* executor
      .run("git", ["symbolic-ref", "--short", "HEAD"], {
        cwd: options.checkout,
      })
      .pipe(
        Effect.map((value) => value.trim()),
        Effect.orElseSucceed(() => ""),
      );

    const exactTag = currentBranch
      ? ""
      : yield* executor
          .run("git", ["describe", "--tags", "--exact-match", "HEAD"], {
            cwd: options.checkout,
          })
          .pipe(
            Effect.map((value) => value.trim()),
            Effect.orElseSucceed(() => ""),
          );

    const branch = currentBranch || exactTag || "main";

    const submodulePath = `omarchy/.config/omarchy/plugins/${id}`;

    yield* Effect.gen(function* () {
      // `submodule add -b` only accepts branches, so a tag is recorded afterwards.
      yield* runInherited(
        "git",
        [
          "submodule",
          "add",
          ...(exactTag ? [] : ["-b", branch]),
          "--",
          httpsGitUrl(options.url),
          submodulePath,
        ],
        paths.repo,
      );

      if (exactTag) {
        yield* executor.run(
          "git",
          [
            "config",
            "-f",
            ".gitmodules",
            `submodule.${submodulePath}.branch`,
            exactTag,
          ],
          { cwd: paths.repo },
        );
      }

      yield* executor.run("git", ["checkout", "-q", sha], {
        cwd: join(paths.pluginsSource, id),
      });
      const registry = yield* readRegistry(paths);

      const plugins = pluginEntries(registry).filter(
        (plugin) => plugin.id !== id,
      );

      const placement: JsonValue = { ...options.placement };
      yield* writeRegistry(paths, {
        ...registry,
        plugins: [
          ...plugins,
          {
            id,
            managed: true,
            ...(options.path && { path: options.path }),
            placement,
          },
        ],
      });
      yield* removeLivePlugin(paths, id);
      yield* stowPublic();
      yield* rescanPlugins();
    }).pipe(Effect.ensuring(unstage(paths, id)));

    process.stdout.write(`Managed ${id} at ${branch} (${sha}).\n`);
    yield* offerCommit(paths, "add", id, registryBeforeAdd);
  });
}

/** Managed plugins fetched at once by a bulk update. */
const PLUGIN_FETCH_CONCURRENCY = 4;

/** Per-attempt bound on a plugin's network fetch. */
const PLUGIN_FETCH_TIMEOUT = Duration.seconds(30);

/** A managed plugin's checked-out and freshly fetched commits. */
interface FetchedPlugin {
  readonly id: string;
  readonly pluginPath: string;
  readonly source: string;
  readonly oldSha: string;
  readonly newSha: string;
}

/** Fetch a managed plugin's tracked branch. Returns `null` for unmanaged plugins. */
function fetchPlugin(paths: OmarchyPluginPaths, id: string) {
  return Effect.gen(function* () {
    yield* requirePluginId(id);

    if (!(yield* isManaged(paths, id))) {
      process.exitCode = UNMANAGED_PLUGIN_EXIT_CODE;

      return null;
    }

    const executor = yield* CommandExecutor;
    const pluginPath = join(paths.pluginsSource, id);
    const submodulePath = `omarchy/.config/omarchy/plugins/${id}`;

    const ref = (yield* executor.run(
      "git",
      [
        "config",
        "-f",
        ".gitmodules",
        "--get",
        `submodule.${submodulePath}.branch`,
      ],
      { cwd: paths.repo },
    )).trim();

    const oldSha = (yield* executor.run("git", ["rev-parse", "HEAD"], {
      cwd: pluginPath,
    })).trim();

    yield* gitRemoteOutput(
      ["fetch", "-q", "origin", ref],
      { cwd: pluginPath },
      PLUGIN_FETCH_TIMEOUT,
    ).pipe(
      Effect.mapError(
        (error) => new OmarchyPluginError({ message: error.message }),
      ),
    );

    const newSha = (yield* executor.run("git", ["rev-parse", "FETCH_HEAD"], {
      cwd: pluginPath,
    })).trim();

    return {
      id,
      pluginPath,
      source: yield* pluginSource(paths, id),
      oldSha,
      newSha,
    } satisfies FetchedPlugin;
  });
}

function applyPluginUpdate(
  paths: OmarchyPluginPaths,
  { id, pluginPath, source, oldSha, newSha }: FetchedPlugin,
  assumeYes: boolean,
) {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    if (oldSha === newSha) {
      process.stdout.write(`${id} is up to date.\n`);

      return;
    }

    if (!assumeYes) {
      yield* runInherited("git", ["diff", oldSha, newSha], pluginPath);

      if (!(yield* confirm(`Update ${id}?`))) {
        process.stdout.write(`Skipped ${id}.\n`);

        return;
      }
    }

    yield* executor.run("git", ["checkout", "-q", newSha], { cwd: pluginPath });

    const validation = yield* executor.inherit("omarchy-plugin-validate", [
      source,
    ]);

    if (validation !== 0) {
      yield* executor.run("git", ["checkout", "-q", oldSha], {
        cwd: pluginPath,
      });

      return yield* fail(`update of '${id}' failed validation; rolled back`);
    }

    yield* deployOmarchyPlugin(
      source,
      join(paths.pluginsLive, id),
      paths.repo,
    ).pipe(
      Effect.tapError(() =>
        executor.run("git", ["checkout", "-q", oldSha], { cwd: pluginPath }),
      ),
    );
    yield* unstage(paths, id);
    yield* rescanPlugins();
    process.stdout.write(`Updated managed plugin ${id} to ${newSha}.\n`);
  });
}

function leftoverParts(paths: OmarchyPluginPaths, id: string) {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const submodulePath = `omarchy/.config/omarchy/plugins/${id}`;
    const leftovers: string[] = [];

    if (yield* pathExists(join(paths.pluginsSource, id)))
      leftovers.push("source");

    if (yield* pathExists(join(paths.pluginsLive, id))) leftovers.push("live");

    if (
      yield* (yield* FileSystem.FileSystem)
        .exists(join(paths.repo, ".git", "modules", submodulePath))
        .pipe(Effect.orElseSucceed(() => false))
    )
      leftovers.push("module-cache");

    const configKeys = yield* executor
      .run("git", ["config", "--name-only", "--get-regexp", "^submodule\\."], {
        cwd: paths.repo,
      })
      .pipe(Effect.orElseSucceed(() => ""));

    if (configKeys.includes(`submodule.${submodulePath}.`))
      leftovers.push("git-config");

    const gitmodulesKeys = yield* executor
      .run(
        "git",
        [
          "config",
          "-f",
          ".gitmodules",
          "--name-only",
          "--get-regexp",
          "^submodule\\.",
        ],
        { cwd: paths.repo },
      )
      .pipe(Effect.orElseSucceed(() => ""));

    if (gitmodulesKeys.includes(`submodule.${submodulePath}.`))
      leftovers.push("gitmodules");
    const registry = yield* readRegistry(paths);

    if (pluginEntries(registry).some((plugin) => plugin.id === id))
      leftovers.push("registry");

    return leftovers;
  });
}

function removePlugin(
  paths: OmarchyPluginPaths,
  id: string,
  assumeYes: boolean,
  offerSave: boolean,
): PluginEffect {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* requirePluginId(id);

    if (!(yield* isManaged(paths, id))) {
      process.exitCode = UNMANAGED_PLUGIN_EXIT_CODE;

      return;
    }

    if (
      !assumeYes &&
      !(yield* confirm(`Remove managed plugin '${id}' from dotfiles?`))
    ) {
      return yield* fail("aborted");
    }

    const executor = yield* CommandExecutor;
    const submodulePath = `omarchy/.config/omarchy/plugins/${id}`;
    yield* executor.exitCode("omarchy-shell", [
      "shell",
      "setPluginEnabled",
      id,
      "false",
    ]);
    yield* removeLivePlugin(paths, id);

    yield* Effect.gen(function* () {
      if (
        (yield* executor.exitCode(
          "git",
          ["ls-files", "--error-unmatch", submodulePath],
          { cwd: paths.repo },
        )) === 0
      ) {
        yield* executor.exitCode(
          "git",
          ["submodule", "deinit", "-q", "-f", "--", submodulePath],
          { cwd: paths.repo },
        );
        yield* executor.run("git", ["rm", "-q", "-f", "--", submodulePath], {
          cwd: paths.repo,
        });
      }

      yield* fs
        .remove(join(paths.pluginsSource, id), { recursive: true, force: true })
        .pipe(
          Effect.mapError(fsError(`could not remove plugin source '${id}'`)),
        );
      yield* executor.exitCode(
        "git",
        ["config", "--remove-section", `submodule.${submodulePath}`],
        { cwd: paths.repo },
      );
      yield* executor.exitCode(
        "git",
        [
          "config",
          "-f",
          ".gitmodules",
          "--remove-section",
          `submodule.${submodulePath}`,
        ],
        { cwd: paths.repo },
      );
      yield* fs
        .remove(join(paths.repo, ".git", "modules", submodulePath), {
          recursive: true,
          force: true,
        })
        .pipe(
          Effect.mapError(
            fsError(`could not remove plugin module cache '${id}'`),
          ),
        );
      const registry = yield* readRegistry(paths);
      yield* writeRegistry(paths, {
        ...registry,
        plugins: pluginEntries(registry).filter((plugin) => plugin.id !== id),
      });
      yield* stowPublic();
      yield* rescanPlugins();
      const leftovers = yield* leftoverParts(paths, id);

      if (leftovers.length > 0) {
        return yield* fail(
          `removal of '${id}' left behind: ${leftovers.join(" ")}`,
        );
      }
    }).pipe(Effect.ensuring(unstage(paths, id)));

    process.stdout.write(`Removed managed plugin ${id}.\n`);

    if (offerSave) yield* offerCommit(paths, "remove", id);
  });
}

function defaultPaths(repo: string): OmarchyPluginPaths {
  const home = process.env.HOME ?? "";
  const configHome = process.env.XDG_CONFIG_HOME ?? join(home, ".config");

  return {
    repo,
    registry: join(repo, "omarchy-plugins.json"),
    pluginsSource: join(repo, "omarchy", ".config", "omarchy", "plugins"),
    pluginsLive: join(configHome, "omarchy", "plugins"),
    prettier:
      process.env.OMARCHY_PLUGIN_PRETTIER ??
      join(repo, "dot", "node_modules", ".bin", "prettier"),
  };
}

/** Run the managed Omarchy plugin add, update, or remove command family. */
export const omarchyPlugin = Effect.fn("omarchyPlugin")(function* (
  input: OmarchyPluginInput,
  pathOverrides?: OmarchyPluginPaths,
) {
  const config = yield* Config;

  const paths =
    pathOverrides ??
    defaultPaths(process.env.DOTFILES_REPO ?? config.publicDotfiles);

  const fs = yield* FileSystem.FileSystem;

  if (
    !(yield* fs.exists(paths.registry).pipe(Effect.orElseSucceed(() => false)))
  ) {
    return yield* fail(`managed plugin registry not found: ${paths.registry}`);
  }

  if (OmarchyPluginInput.$is("add")(input)) {
    if (input.path !== undefined && !isRelativePluginPath(input.path)) {
      return yield* fail(`invalid plugin path '${input.path}'`);
    }

    const defaultSection = yield* manifestDefaultSection(
      join(input.checkout, input.path ?? ""),
    );

    const placement = yield* parsePlacement(
      [
        ...(input.section ? ["--section", input.section] : []),
        ...(input.before ? ["--before", input.before] : []),
        ...(input.after ? ["--after", input.after] : []),
      ],
      defaultSection,
    );

    return yield* addPlugin(paths, {
      id: input.id,
      url: input.url,
      checkout: input.checkout,
      ...(input.path && { path: input.path }),
      placement,
    });
  }

  if (OmarchyPluginInput.$is("update")(input)) {
    if (input.id) {
      const plugin = yield* fetchPlugin(paths, input.id);

      if (plugin) yield* applyPluginUpdate(paths, plugin, input.yes);

      return;
    }

    // Fetch concurrently, then review and apply one at a time.
    const fetched = yield* Effect.forEach(
      yield* managedPluginIds(paths),
      (managedId) => fetchPlugin(paths, managedId),
      { concurrency: PLUGIN_FETCH_CONCURRENCY },
    );

    for (const plugin of fetched) {
      if (plugin) yield* applyPluginUpdate(paths, plugin, input.yes);
    }

    process.exitCode = UNMANAGED_PLUGIN_EXIT_CODE;

    return;
  }

  if (OmarchyPluginInput.$is("remove")(input)) {
    const id = yield* requirePluginId(input.id);

    return yield* removePlugin(paths, id, input.yes, input.offerCommit);
  }
});
