import { Effect, Schema } from "effect";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { ENV, envString } from "../../lib/env.js";
import {
  CACHE_DIR,
  CONFIG_DIR,
  HOME_DIR,
  STATE_DIR,
  displayPath,
} from "../../lib/paths.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import { managedGitRepos } from "../../services/GitConfig.js";
import type { CheckResult } from "../types.js";

const OPENCODE_CONFIG_DIR = join(CONFIG_DIR, "opencode");

/** Files OpenCode 1 created when it auto-installed its plugin package. */
const PLUGIN_INSTALL_FILES = [
  "node_modules",
  "package.json",
  "package-lock.json",
  "bun.lock",
] as const;

/** Paths only OpenCode 1 or its web server used. */
const RETIRED_CONFIG_PATHS = [".env", "tui-plugins", "plugins-v2"] as const;

/** Caches only OpenCode 1 plugins wrote. */
const RETIRED_CACHE_PATHS = ["opencode-cursor"] as const;

const PLUGIN_INSTALL_NAMES: ReadonlySet<string> = new Set(PLUGIN_INSTALL_FILES);

const RETIRED_MISE_TOOLS = [
  "aqua:anomalyco/opencode",
  "npm:@opencode-ai/cli",
  "npm:opencode-ai",
] as const;

const MiseInstalls = Schema.Record(Schema.String, Schema.Array(Schema.Unknown));

const shellQuote = (path: string) => `'${path.replaceAll("'", `'"'"'`)}'`;

function dependsOnV1Plugin(directory: string): boolean {
  try {
    return readFileSync(join(directory, "package.json"), "utf-8").includes(
      '"@opencode-ai/plugin"',
    );
  } catch {
    return false;
  }
}

/** Only remove a .gitignore that lists nothing but the plugin install files. */
function generatedGitignore(directory: string): boolean {
  try {
    const lines = readFileSync(join(directory, ".gitignore"), "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return (
      lines.length > 0 &&
      lines.every(
        (line) => PLUGIN_INSTALL_NAMES.has(line) || line === ".gitignore",
      )
    );
  } catch {
    return false;
  }
}

function pluginInstallLeftovers(directory: string): readonly string[] {
  const v1Install = dependsOnV1Plugin(directory);

  // The generated .gitignore outlives a partial clean-up, but a newer install may still own it.
  const staleGitignore =
    generatedGitignore(directory) &&
    (v1Install || !existsSync(join(directory, "package.json")));

  return [
    ...(v1Install ? PLUGIN_INSTALL_FILES : []),
    ...(staleGitignore ? [".gitignore"] : []),
  ].flatMap((name) => {
    const path = join(directory, name);

    return existsSync(path) ? [path] : [];
  });
}

function repoOpencodeDirectories(root: string): readonly string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name === ".opencode" || entry.name.startsWith(".opencode-")),
      )
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

/** Report files left behind by OpenCode 1, with the command that removes them. */
export const checkOpencodeLegacy = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  const repoRoots = [
    ...new Set([
      config.publicDotfiles,
      ...(config.privateDotfiles ? [config.privateDotfiles] : []),
      ...managedGitRepos(config.gitConfig).map((repo) => repo.path),
    ]),
  ];

  const leftovers = [
    ...pluginInstallLeftovers(OPENCODE_CONFIG_DIR),
    ...RETIRED_CONFIG_PATHS.flatMap((name) => {
      const path = join(OPENCODE_CONFIG_DIR, name);

      return existsSync(path) ? [path] : [];
    }),
    ...RETIRED_CACHE_PATHS.flatMap((name) => {
      const path = join(CACHE_DIR, name);

      return existsSync(path) ? [path] : [];
    }),
    ...repoRoots.flatMap((root) =>
      repoOpencodeDirectories(root).flatMap(pluginInstallLeftovers),
    ),
    ...[join(config.publicDotfiles, ".benchmarks", "output")].filter((path) =>
      existsSync(path),
    ),
  ];

  if (leftovers.length > 0) {
    results.push({
      severity: "warn",
      message: `OpenCode 1 files remain: ${leftovers.map(displayPath).join(", ")}`,
      detail: `Run rm -rf ${leftovers.map(shellQuote).join(" ")}`,
    });
  }

  const dataDir =
    envString(ENV.XDG_DATA_HOME) ?? join(HOME_DIR, ".local", "share");

  const oldData = join(dataDir, "opencode");
  const v2Data = join(dataDir, "opencode-v2", "opencode");

  if (existsSync(join(v2Data, "opencode.db"))) {
    const oldState = join(STATE_DIR, "opencode");
    const v2State = join(STATE_DIR, "opencode-v2", "opencode");
    const oldCache = join(CACHE_DIR, "opencode");
    const v2Cache = join(CACHE_DIR, "opencode-v2", "runtime", "opencode");

    results.push({
      severity: "warn",
      message: `OpenCode 2 data is still at ${displayPath(v2Data)}`,
      detail: [
        "After exiting OpenCode on every pane, stop its old service:",
        `XDG_STATE_HOME=${shellQuote(join(STATE_DIR, "opencode-v2"))} OPENCODE_CONFIG_DIR=${shellQuote(join(CONFIG_DIR, "opencode-v2", "cli"))} XDG_CONFIG_HOME=${shellQuote(join(CACHE_DIR, "opencode-v2", "runtime-config"))} "$(mise which opencode2)" service stop`,
        "Archive the OpenCode 1 history and move the OpenCode 2 data (stop if an archive path already exists):",
        `mv -T ${shellQuote(oldData)} ${shellQuote(join(dataDir, "opencode-v1-archive"))}`,
        `mv -T ${shellQuote(v2Data)} ${shellQuote(oldData)}`,
        `rm ${shellQuote(join(oldData, "auth.json"))} && cp -p ${shellQuote(join(dataDir, "opencode-v1-archive", "auth.json"))} ${shellQuote(join(oldData, "auth.json"))}`,
        `mv -T ${shellQuote(oldState)} ${shellQuote(join(STATE_DIR, "opencode-v1-archive"))} && mv -T ${shellQuote(v2State)} ${shellQuote(oldState)}`,
        `mv -T ${shellQuote(oldCache)} ${shellQuote(join(CACHE_DIR, "opencode-v1-archive"))} && mv -T ${shellQuote(v2Cache)} ${shellQuote(oldCache)}`,
        `rm ${shellQuote(join(CONFIG_DIR, "opencode", "cli.json"))}`,
        `ctx sources add --provider opencode --root ${shellQuote(join(dataDir, "opencode-v1-archive", "opencode.db"))} v1-archive`,
        "Run dot doctor again before starting OpenCode. Keep the archived history until ctx can import OpenCode 2 sessions.",
      ].join("\n"),
    });
  } else {
    const oldRoots = [
      join(dataDir, "opencode-v2"),
      join(STATE_DIR, "opencode-v2"),
      join(CACHE_DIR, "opencode-v2"),
      join(CONFIG_DIR, "opencode-v2"),
      ...(config.privateDotfiles
        ? [join(config.privateDotfiles, "agents", ".config", "opencode-v2")]
        : []),
    ].filter((path) => existsSync(path));

    if (oldRoots.length > 0) {
      results.push({
        severity: "warn",
        message: `Old OpenCode 2 runtime paths remain: ${oldRoots.map(displayPath).join(", ")}`,
        detail:
          "After confirming OpenCode works at the default paths, inspect these directories and remove the retired runtime copies.",
      });
    }
  }

  const installed = yield* executor
    .run("mise", ["ls", "--installed", "--json"])
    .pipe(
      Effect.flatMap((output) =>
        Schema.decodeEffect(Schema.fromJsonString(MiseInstalls))(output),
      ),
      Effect.orElseSucceed(() => ({})),
    );

  const miseTools = RETIRED_MISE_TOOLS.filter((tool) => tool in installed);

  if (miseTools.length > 0) {
    results.push({
      severity: "warn",
      message: `OpenCode 1 mise installs remain: ${miseTools.join(", ")}`,
      detail: `Run mise uninstall --all ${miseTools.join(" ")}`,
    });
  }

  const pitchfork = yield* executor
    .run("pitchfork", ["list"])
    .pipe(Effect.orElseSucceed(() => ""));

  if (/^global\/agent-benchmark\s/m.test(pitchfork)) {
    results.push({
      severity: "warn",
      message: "Retired agent-benchmark pitchfork daemon is still registered",
      detail: "Run pitchfork clean to remove stopped daemons",
    });
  }

  if (results.length === 0) {
    results.push({ severity: "ok", message: "No OpenCode 1 leftovers found" });
  }

  return results;
});
