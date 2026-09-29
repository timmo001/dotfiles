import { Effect, FileSystem, Schema } from "effect";
import { basename, isAbsolute, join, relative, resolve } from "path";
import packageJson from "../../../package.json" with { type: "json" };
import { decodeJson, isJsonObject, isString } from "../lib/schema.js";
import {
  CommandExecutor,
  type CommandError,
} from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import {
  loadDotGitConfig,
  managedGitRepoForPath,
} from "../services/GitConfig.js";
import { OutputLog } from "../services/OutputLog.js";
import { agentOxlintOptInText } from "../lib/agentOxlintOptIn.js";
import {
  commitGitRepoConfigEdit,
  prepareGitRepoConfigEdit,
} from "../lib/gitRepoConfig.js";
import { canPromptForInduction, inductRepository } from "./RepoInduct.js";
import { Prompt } from "effect/cli";

const MANAGED_DEPENDENCIES = {
  "@oxlint/plugins": packageJson.devDependencies["@oxlint/plugins"],
  "@timmo001/oxlint-rules":
    packageJson.devDependencies["@timmo001/oxlint-rules"],
  oxlint: packageJson.devDependencies.oxlint,
} as const;

const RULE_OVERRIDES = {
  "anti-slop/no-runtime-typeof": "warn",
  "anti-slop/require-safety-comment-for-type-assertion": "warn",
} as const;

const CONFIG_NAMES = new Set([
  ".oxlintrc.json",
  ".oxlintrc.jsonc",
  "oxlint.config.js",
  "oxlint.config.mjs",
  "oxlint.config.cjs",
  "oxlint.config.ts",
  "oxlint.config.mts",
  "oxlint.config.cts",
]);

const CACHE_MANIFEST = `${JSON.stringify(
  {
    name: "dot-agent-oxlint",
    private: true,
    type: "module",
    dependencies: MANAGED_DEPENDENCIES,
  },
  null,
  2,
)}\n`;

const CACHE_CONFIG = [
  'import { defineConfig } from "oxlint";',
  'import recommended from "@timmo001/oxlint-rules/configs/recommended";',
  "",
  "export default defineConfig({",
  "  extends: [recommended],",
  `  rules: ${JSON.stringify(RULE_OVERRIDES, null, 2)
    .split("\n")
    .join("\n  ")},`,
  "});",
  "",
].join("\n");

/** Options accepted by the agent Oxlint command. */
export interface AgentOxlintOptions {
  /** Repository-relative files or directories to lint. */
  readonly paths: readonly string[];
  /** Lint the complete repository tree instead of explicit paths. */
  readonly all: boolean;
  /** Run even if the repository is not opted in or already has Oxlint. */
  readonly force: boolean;
  /** Enable and commit the current repository's existing private config entry. */
  readonly optIn: boolean;
}

/** Domain error raised before Oxlint starts. */
export class AgentOxlintError extends Schema.TaggedError<AgentOxlintError>()(
  "AgentOxlintError",
  { message: Schema.String },
) {}

interface AgentOxlintCache {
  readonly directory: string;
  readonly manifest: string;
  readonly config: string;
  readonly binary: string;
}

function fail(message: string): AgentOxlintError {
  return new AgentOxlintError({ message });
}

function cachePaths(cacheDir: string): AgentOxlintCache {
  const directory = join(
    cacheDir,
    "agent-oxlint",
    `rules-${MANAGED_DEPENDENCIES["@timmo001/oxlint-rules"]}-oxlint-${MANAGED_DEPENDENCIES.oxlint}-plugins-${MANAGED_DEPENDENCIES["@oxlint/plugins"]}`,
  );

  return {
    directory,
    manifest: join(directory, "package.json"),
    config: join(directory, "oxlint.config.mjs"),
    binary: join(directory, "node_modules", ".bin", "oxlint"),
  };
}

const readText = Effect.fn("agentOxlint.readText")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => null));
});

const installedVersion = Effect.fn("agentOxlint.installedVersion")(function* (
  path: string,
) {
  const contents = yield* readText(path);

  if (contents === null) return null;

  return yield* Effect.try(() => {
    const value = decodeJson(JSON.parse(contents));

    return isJsonObject(value) && isString(value.version)
      ? value.version
      : null;
  }).pipe(Effect.orElseSucceed(() => null));
});

const cacheReady = Effect.fn("agentOxlint.cacheReady")(function* (
  cache: AgentOxlintCache,
) {
  const fs = yield* FileSystem.FileSystem;

  return (
    (yield* readText(cache.manifest)) === CACHE_MANIFEST &&
    (yield* readText(cache.config)) === CACHE_CONFIG &&
    (yield* fs.exists(cache.binary).pipe(Effect.orElseSucceed(() => false))) &&
    (yield* installedVersion(
      join(cache.directory, "node_modules", "oxlint", "package.json"),
    )) === MANAGED_DEPENDENCIES.oxlint &&
    (yield* installedVersion(
      join(
        cache.directory,
        "node_modules",
        "@oxlint",
        "plugins",
        "package.json",
      ),
    )) === MANAGED_DEPENDENCIES["@oxlint/plugins"] &&
    (yield* installedVersion(
      join(
        cache.directory,
        "node_modules",
        "@timmo001",
        "oxlint-rules",
        "package.json",
      ),
    )) === MANAGED_DEPENDENCIES["@timmo001/oxlint-rules"]
  );
});

const writeCache = Effect.fn("agentOxlint.writeCache")(function* (
  cache: AgentOxlintCache,
) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(cache.directory, { recursive: true });
  yield* fs.writeFileString(cache.manifest, CACHE_MANIFEST);
  yield* fs.writeFileString(cache.config, CACHE_CONFIG);
});

const packageUsesOxlint = Effect.fn("agentOxlint.packageUsesOxlint")(function* (
  path: string,
) {
  const contents = yield* readText(path);

  return contents !== null && /\boxlint\b/.test(contents);
});

const hasLocalOxlint = Effect.fn("agentOxlint.hasLocalOxlint")(function* (
  root: string,
  files: readonly string[],
) {
  const fs = yield* FileSystem.FileSystem;

  const exists = (path: string) =>
    fs.exists(path).pipe(Effect.orElseSucceed(() => false));

  if (yield* exists(join(root, "node_modules", ".bin", "oxlint"))) return true;

  for (const name of CONFIG_NAMES) {
    if (yield* exists(join(root, name))) return true;
  }

  if (yield* packageUsesOxlint(join(root, "package.json"))) return true;

  for (const file of files) {
    const name = basename(file);

    if (CONFIG_NAMES.has(name)) return true;

    if (
      name === "package.json" &&
      (yield* packageUsesOxlint(join(root, file)))
    ) {
      return true;
    }
  }

  return false;
});

function pathInsideRoot(root: string, path: string): boolean {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const offset = relative(root, absolute);

  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

function commandError(
  error: CommandError,
  operation: string,
): AgentOxlintError {
  return fail(`${operation}: ${error.stderr || `exit ${error.exitCode}`}`);
}

const optInRepository = Effect.fn("agentOxlint.optIn")(
  function* (root: string) {
    const log = yield* OutputLog;
    const edit = yield* prepareGitRepoConfigEdit();

    const repositoryIndex = edit.config.repositories.findIndex(
      (repo) => repo.path === root,
    );

    if (repositoryIndex < 0) {
      if (!canPromptForInduction()) {
        return yield* fail(
          `agent-oxlint: repository is not inducted. Run dot repo-induct ${JSON.stringify(root)} in a terminal, or add --noninteractive --agent-oxlint to preview with flags, then --commit after approval`,
        );
      }

      if (
        !(yield* Prompt.run(
          Prompt.Confirm({
            message: "Repository is not inducted. Induct it now?",
            initial: false,
          }),
        ))
      )
        return false;

      const inducted = yield* inductRepository({
        path: root,
        agentOxlint: true,
      });

      return inducted?.path === root && inducted.agentOxlint;
    }

    const updated = yield* Effect.try({
      try: () => agentOxlintOptInText(edit.source, repositoryIndex),
      catch: (error) => fail(`agent-oxlint: ${String(error)}`),
    });

    if (updated === edit.source) {
      yield* log.info("Repository is already opted into agent Oxlint");

      return true;
    }

    yield* commitGitRepoConfigEdit(
      edit,
      updated,
      "Opt repository into agent Oxlint",
    );

    return true;
  },
  Effect.catchTag("QuitError", () => Effect.succeed(false)),
);

/** Run the generic personal Oxlint pass when the current repository opts in or --force is set. */
export const agentOxlint = Effect.fn("agentOxlint")(function* (
  options: AgentOxlintOptions,
) {
  if (options.all && options.paths.length > 0) {
    return yield* fail("agent-oxlint: --all cannot be combined with paths");
  }

  if (!options.optIn && !options.all && options.paths.length === 0) {
    return yield* fail("agent-oxlint: pass changed paths or use --all");
  }

  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;
  let gitConfig = config.gitConfig;

  const root = (yield* executor
    .run("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
    })
    .pipe(
      Effect.mapError((error) =>
        commandError(error, "agent-oxlint: not inside a Git repository"),
      ),
    )).trim();

  const targets = options.all ? ["."] : options.paths;
  const escaped = targets.find((path) => !pathInsideRoot(root, path));

  if (escaped) {
    return yield* fail(
      `agent-oxlint: path is outside the repository: ${escaped}`,
    );
  }

  if (options.optIn) {
    if (!(yield* optInRepository(root))) return;

    if (!options.all && options.paths.length === 0) return;
    gitConfig = yield* loadDotGitConfig(config.gitConfig.filePath);
  }

  if (options.force) {
    yield* log.warn(
      "Forcing agent Oxlint: skipping opt-in and repository Oxlint gates (--force)",
    );
  } else if (!gitConfig.valid) {
    yield* log.info("Private git config is unavailable; skipping agent Oxlint");

    return;
  } else if (!managedGitRepoForPath(gitConfig, root)?.agentOxlint) {
    yield* log.info("Repository is not opted into agent Oxlint; skipping");

    return;
  }

  const files = (yield* executor
    .run("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
    })
    .pipe(
      Effect.mapError((error) =>
        commandError(error, "agent-oxlint: could not inspect repository files"),
      ),
    )).split("\n");

  if ((yield* hasLocalOxlint(root, files)) && !options.force) {
    yield* log.info("Repository Oxlint takes precedence; skipping agent pass");

    return;
  }

  const cache = cachePaths(config.cacheDir);

  if (!(yield* cacheReady(cache))) {
    yield* writeCache(cache).pipe(
      Effect.mapError((error) =>
        fail(`agent-oxlint: could not prepare managed cache: ${String(error)}`),
      ),
    );

    const installExit = yield* executor.inherit("bun", [
      "install",
      "--production",
      "--cwd",
      cache.directory,
    ]);

    if (installExit !== 0) {
      process.exitCode = installExit;

      return;
    }

    if (!(yield* cacheReady(cache))) {
      return yield* fail(
        "agent-oxlint: managed cache is incomplete after install",
      );
    }
  }

  const lintExit = yield* executor.inherit(
    cache.binary,
    ["--config", cache.config, ...targets],
    { cwd: root },
  );

  if (lintExit !== 0) process.exitCode = lintExit;
});
