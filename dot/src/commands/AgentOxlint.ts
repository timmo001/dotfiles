import { Effect, Schema } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, isAbsolute, join, relative, resolve } from "path";
import packageJson from "../../package.json" with { type: "json" };
import { decodeJson, isJsonObject, isString } from "../lib/schema.js";
import {
  CommandExecutor,
  type CommandError,
} from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { managedGitRepoForPath } from "../services/GitConfig.js";
import { OutputLog } from "../services/OutputLog.js";

const MANAGED_DEPENDENCIES = {
  "@oxlint/plugins": packageJson.devDependencies["@oxlint/plugins"],
  "@timmo001/oxlint-rules":
    packageJson.devDependencies["@timmo001/oxlint-rules"],
  oxlint: packageJson.devDependencies.oxlint,
} as const;
const RULE_OVERRIDES = {
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

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function installedVersion(path: string): string | null {
  try {
    const value = decodeJson(JSON.parse(readFileSync(path, "utf-8")));
    return isJsonObject(value) && isString(value.version)
      ? value.version
      : null;
  } catch {
    return null;
  }
}

function cacheReady(cache: AgentOxlintCache): boolean {
  return (
    readText(cache.manifest) === CACHE_MANIFEST &&
    readText(cache.config) === CACHE_CONFIG &&
    existsSync(cache.binary) &&
    installedVersion(
      join(cache.directory, "node_modules", "oxlint", "package.json"),
    ) === MANAGED_DEPENDENCIES.oxlint &&
    installedVersion(
      join(
        cache.directory,
        "node_modules",
        "@oxlint",
        "plugins",
        "package.json",
      ),
    ) === MANAGED_DEPENDENCIES["@oxlint/plugins"] &&
    installedVersion(
      join(
        cache.directory,
        "node_modules",
        "@timmo001",
        "oxlint-rules",
        "package.json",
      ),
    ) === MANAGED_DEPENDENCIES["@timmo001/oxlint-rules"]
  );
}

function writeCache(cache: AgentOxlintCache): void {
  mkdirSync(cache.directory, { recursive: true });
  writeFileSync(cache.manifest, CACHE_MANIFEST);
  writeFileSync(cache.config, CACHE_CONFIG);
}

function packageUsesOxlint(path: string): boolean {
  const contents = readText(path);
  return contents !== null && /\boxlint\b/.test(contents);
}

function hasLocalOxlint(root: string, files: readonly string[]): boolean {
  if (existsSync(join(root, "node_modules", ".bin", "oxlint"))) return true;
  if ([...CONFIG_NAMES].some((name) => existsSync(join(root, name))))
    return true;
  if (packageUsesOxlint(join(root, "package.json"))) return true;
  return files.some((file) => {
    const name = basename(file);
    return (
      CONFIG_NAMES.has(name) ||
      (name === "package.json" && packageUsesOxlint(join(root, file)))
    );
  });
}

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

/** Run the generic personal Oxlint pass when the current repository opts in. */
export const agentOxlint = Effect.fn("agentOxlint")(function* (
  options: AgentOxlintOptions,
) {
  if (options.all && options.paths.length > 0) {
    return yield* fail("agent-oxlint: --all cannot be combined with paths");
  }
  if (!options.all && options.paths.length === 0) {
    return yield* fail("agent-oxlint: pass changed paths or use --all");
  }

  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;
  const root = (yield* executor
    .run("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
    })
    .pipe(
      Effect.mapError((error) =>
        commandError(error, "agent-oxlint: not inside a Git repository"),
      ),
    )).trim();

  if (!config.gitConfig.valid) {
    yield* log.info("Private git config is unavailable; skipping agent Oxlint");
    return;
  }
  const repository = managedGitRepoForPath(config.gitConfig, root);
  if (!repository?.agentOxlint) {
    yield* log.info("Repository is not opted into agent Oxlint; skipping");
    return;
  }
  const targets = options.all ? ["."] : options.paths;
  const escaped = targets.find((path) => !pathInsideRoot(root, path));
  if (escaped) {
    return yield* fail(
      `agent-oxlint: path is outside the repository: ${escaped}`,
    );
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
  if (hasLocalOxlint(root, files)) {
    yield* log.info("Repository Oxlint takes precedence; skipping agent pass");
    return;
  }

  const cache = cachePaths(config.cacheDir);
  if (!cacheReady(cache)) {
    yield* Effect.try({
      try: () => writeCache(cache),
      catch: (error) =>
        fail(`agent-oxlint: could not prepare managed cache: ${String(error)}`),
    });
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
    if (!cacheReady(cache)) {
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
