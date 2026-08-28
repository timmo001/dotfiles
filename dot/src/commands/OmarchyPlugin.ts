import { Effect, Schema } from "effect";
import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
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
export class OmarchyPluginError extends Schema.TaggedErrorClass<OmarchyPluginError>()(
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
  readonly placement: Placement;
}

type PluginEffect = Effect.Effect<
  void,
  OmarchyPluginError | CommandError,
  CommandExecutor
>;

function fail(message: string): Effect.Effect<never, OmarchyPluginError> {
  return Effect.fail(new OmarchyPluginError({ message }));
}

function validPluginId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes("..");
}

function pathExists(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
}

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

function readRegistry(
  paths: OmarchyPluginPaths,
): Effect.Effect<JsonObject, OmarchyPluginError> {
  return Effect.try({
    try: () => {
      const registry = decodeJsonObject(
        JSON.parse(readFileSync(paths.registry, "utf8")),
      );
      pluginEntries(registry);
      return registry;
    },
    catch: (error) =>
      error instanceof OmarchyPluginError
        ? error
        : new OmarchyPluginError({
            message: `invalid managed plugin registry: ${paths.registry}: ${String(error)}`,
          }),
  });
}

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

function fsEffect(action: () => void, message: string) {
  return Effect.try({
    try: action,
    catch: (error) =>
      new OmarchyPluginError({ message: `${message}: ${String(error)}` }),
  });
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
    if (!existsSync(paths.prettier)) {
      return yield* fail(`Prettier not found: ${paths.prettier}`);
    }
    const temporary = `${paths.registry}.tmp.${process.pid}`;
    yield* fsEffect(
      () => writeFileSync(temporary, `${JSON.stringify(registry)}\n`),
      `could not write temporary registry`,
    );
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
      yield* fsEffect(
        () => renameSync(temporary, paths.registry),
        `could not replace managed plugin registry`,
      );
    }).pipe(
      Effect.ensuring(Effect.sync(() => rmSync(temporary, { force: true }))),
    );
  });
}

function restoreRegistry(paths: OmarchyPluginPaths, contents: string) {
  const temporary = `${paths.registry}.tmp.${process.pid}`;
  return fsEffect(() => {
    try {
      writeFileSync(temporary, contents);
      renameSync(temporary, paths.registry);
    } finally {
      rmSync(temporary, { force: true });
    }
  }, "could not restore managed plugin registry");
}

function removeLivePlugin(paths: OmarchyPluginPaths, id: string) {
  return fsEffect(
    () => rmSync(join(paths.pluginsLive, id), { recursive: true, force: true }),
    `could not remove live plugin '${id}'`,
  );
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
  return Effect.tryPromise({
    try: async (signal) => {
      const proc = Bun.spawn(
        ["gum", "choose", `--header=${header}`, "--selected", "No", ...choices],
        {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "inherit",
          env: process.env,
          signal,
        },
      );
      const output = await new Response(proc.stdout).text();
      return (await proc.exited) === 0 ? output.trim() : "";
    },
    catch: (error) =>
      new OmarchyPluginError({
        message: `could not open choice prompt: ${String(error)}`,
      }),
  }).pipe(Effect.orElseSucceed(() => ""));
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

function manifestDefaultSection(checkout: string) {
  return Effect.try({
    try: () => {
      const manifest = decodeJsonObject(
        JSON.parse(readFileSync(join(checkout, "manifest.json"), "utf8")),
      );
      const barWidget = manifest.barWidget;
      return isJsonObject(barWidget) && isString(barWidget.defaultSection)
        ? barWidget.defaultSection
        : "center";
    },
    catch: (error) =>
      new OmarchyPluginError({
        message: `could not read plugin manifest: ${String(error)}`,
      }),
  });
}

function addPlugin(paths: OmarchyPluginPaths, options: AddOptions) {
  return Effect.gen(function* () {
    const id = yield* requirePluginId(options.id);
    if (pathExists(join(paths.pluginsSource, id))) {
      return yield* fail(`managed plugin '${id}' already exists`);
    }
    const executor = yield* CommandExecutor;
    const registryBeforeAdd = yield* Effect.try({
      try: () => readFileSync(paths.registry, "utf8"),
      catch: (error) =>
        new OmarchyPluginError({
          message: `could not read managed plugin registry: ${String(error)}`,
        }),
    });
    const sha = (yield* executor.run("git", ["rev-parse", "HEAD"], {
      cwd: options.checkout,
    })).trim();
    const exactTag = yield* executor
      .run("git", ["describe", "--tags", "--exact-match", "HEAD"], {
        cwd: options.checkout,
      })
      .pipe(
        Effect.map((value) => value.trim()),
        Effect.orElseSucceed(() => ""),
      );
    const branch =
      exactTag ||
      (yield* executor
        .run("git", ["symbolic-ref", "--short", "HEAD"], {
          cwd: options.checkout,
        })
        .pipe(
          Effect.map((value) => value.trim()),
          Effect.orElseSucceed(() => ""),
        )) ||
      "main";
    const submodulePath = `omarchy/.config/omarchy/plugins/${id}`;

    yield* Effect.gen(function* () {
      yield* runInherited(
        "git",
        [
          "submodule",
          "add",
          "-b",
          branch,
          "--",
          httpsGitUrl(options.url),
          submodulePath,
        ],
        paths.repo,
      );
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
        plugins: [...plugins, { id, managed: true, placement }],
      });
      yield* removeLivePlugin(paths, id);
      yield* stowPublic();
      yield* rescanPlugins();
    }).pipe(Effect.ensuring(unstage(paths, id)));

    process.stdout.write(`Managed ${id} at ${branch} (${sha}).\n`);
    yield* offerCommit(paths, "add", id, registryBeforeAdd);
  });
}

function updatePlugin(
  paths: OmarchyPluginPaths,
  id: string,
  assumeYes: boolean,
) {
  return Effect.gen(function* () {
    yield* requirePluginId(id);
    if (!(yield* isManaged(paths, id))) {
      process.exitCode = UNMANAGED_PLUGIN_EXIT_CODE;
      return;
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
    yield* executor.run("git", ["fetch", "-q", "origin", ref], {
      cwd: pluginPath,
    });
    const newSha = (yield* executor.run("git", ["rev-parse", "FETCH_HEAD"], {
      cwd: pluginPath,
    })).trim();
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
      pluginPath,
    ]);
    if (validation !== 0) {
      yield* executor.run("git", ["checkout", "-q", oldSha], {
        cwd: pluginPath,
      });
      return yield* fail(`update of '${id}' failed validation; rolled back`);
    }
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
    if (pathExists(join(paths.pluginsSource, id))) leftovers.push("source");
    if (pathExists(join(paths.pluginsLive, id))) leftovers.push("live");
    if (existsSync(join(paths.repo, ".git", "modules", submodulePath)))
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
      yield* fsEffect(
        () =>
          rmSync(join(paths.pluginsSource, id), {
            recursive: true,
            force: true,
          }),
        `could not remove plugin source '${id}'`,
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
      yield* fsEffect(
        () =>
          rmSync(join(paths.repo, ".git", "modules", submodulePath), {
            recursive: true,
            force: true,
          }),
        `could not remove plugin module cache '${id}'`,
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

function parseBooleanCompatibility(value: string | undefined): boolean {
  return value === "1";
}

/** Run the managed Omarchy plugin add, update, or remove command family. */
export const omarchyPlugin = Effect.fn("omarchyPlugin")(function* (
  args: readonly string[],
  pathOverrides?: OmarchyPluginPaths,
) {
  const config = yield* Config;
  const paths =
    pathOverrides ??
    defaultPaths(process.env.DOTFILES_REPO ?? config.publicDotfiles);
  if (!existsSync(paths.registry)) {
    return yield* fail(`managed plugin registry not found: ${paths.registry}`);
  }
  const [command, ...rest] = args;
  if (command === "add") {
    const [id, url, checkout, ...placementArgs] = rest;
    if (!id || !url || !checkout) {
      return yield* fail(
        "usage: dot omarchy-plugin add <id> <url> <checkout> [placement]",
      );
    }
    const defaultSection = yield* manifestDefaultSection(checkout);
    const placement = yield* parsePlacement(placementArgs, defaultSection);
    return yield* addPlugin(paths, { id, url, checkout, placement });
  }
  if (command === "update") {
    const id = rest.find(
      (arg) => !arg.startsWith("-") && arg !== "1" && arg !== "0",
    );
    const assumeYes =
      rest.includes("--yes") || parseBooleanCompatibility(rest[1]);
    const unknown = rest.find((arg, index) =>
      arg.startsWith("-")
        ? arg !== "--yes"
        : index > 1 || (index === 1 && arg !== "0" && arg !== "1"),
    );
    if (unknown) return yield* fail(`unknown update argument: ${unknown}`);
    if (id) return yield* updatePlugin(paths, id, assumeYes);
    for (const managedId of yield* managedPluginIds(paths)) {
      yield* updatePlugin(paths, managedId, assumeYes);
    }
    process.exitCode = UNMANAGED_PLUGIN_EXIT_CODE;
    return;
  }
  if (command === "remove") {
    const id = yield* requirePluginId(rest[0]);
    const assumeYes =
      rest.includes("--yes") || parseBooleanCompatibility(rest[1]);
    const offerSave = !rest.includes("--no-commit-offer") && rest[2] !== "0";
    const unknown = rest.find((arg, index) =>
      arg.startsWith("-")
        ? arg !== "--yes" && arg !== "--no-commit-offer"
        : index > 2 || (index > 0 && arg !== "0" && arg !== "1"),
    );
    if (unknown) return yield* fail(`unknown remove argument: ${unknown}`);
    return yield* removePlugin(paths, id, assumeYes, offerSave);
  }
  return yield* fail("usage: dot omarchy-plugin <add|update|remove> ...");
});
