import { Effect, FileSystem, Schema } from "effect";
import { basename, extname, isAbsolute, join, relative, resolve } from "path";
import packageJson from "../../../package.json" with { type: "json" };
import { plural } from "../lib/runSummary.js";
import { decodeJson, isJsonObject, isString } from "../lib/schema.js";
import {
  CommandExecutor,
  type CommandError,
} from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import {
  type DotGitConfig,
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
  "typescript/no-non-null-assertion": "warn",
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
  /** Lint uncommitted changes and report only findings on added or modified lines. */
  readonly changed: boolean;
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

type AgentOxlintGate =
  | { readonly ready: true; readonly cache: AgentOxlintCache }
  | {
      readonly ready: false;
      readonly reason: string;
      readonly exitCode?: number;
    };

const repositoryRoot = Effect.fn("agentOxlint.repositoryRoot")(function* () {
  const executor = yield* CommandExecutor;

  return (yield* executor
    .run("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() })
    .pipe(
      Effect.mapError((error) =>
        commandError(error, "agent-oxlint: not inside a Git repository"),
      ),
    )).trim();
});

const prepareAgentOxlint = Effect.fn("agentOxlint.prepare")(function* (
  root: string,
  gitConfig: DotGitConfig,
  force: boolean,
) {
  const config = yield* Config;
  const executor = yield* CommandExecutor;

  const skipped = (reason: string, exitCode?: number): AgentOxlintGate => ({
    ready: false,
    reason,
    exitCode,
  });

  if (!force) {
    if (!gitConfig.valid) {
      return skipped(
        "Private git config is unavailable; skipping agent Oxlint",
      );
    }

    if (!managedGitRepoForPath(gitConfig, root)?.agentOxlint) {
      return skipped("Repository is not opted into agent Oxlint; skipping");
    }
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

  if (!force && (yield* hasLocalOxlint(root, files))) {
    return skipped("Repository Oxlint takes precedence; skipping agent pass");
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
      return skipped("Could not install the managed Oxlint cache", installExit);
    }

    if (!(yield* cacheReady(cache))) {
      return yield* fail(
        "agent-oxlint: managed cache is incomplete after install",
      );
    }
  }

  return { ready: true, cache } satisfies AgentOxlintGate;
});

const LINTABLE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Which changes the changed-lines pass inspects. */
export type AgentOxlintChangeScope =
  | { readonly kind: "worktree" }
  | { readonly kind: "staged"; readonly amend: boolean }
  | {
      readonly kind: "paths";
      readonly paths: readonly string[];
      readonly amend: boolean;
    };

type LineRange = readonly [start: number, end: number];

/** Added or modified line ranges per repository-relative file; `all` marks an untracked file. */
type ChangedLines = ReadonlyMap<string, readonly LineRange[] | "all">;

/** An Oxlint diagnostic reported on an added or modified line. */
export interface AgentOxlintFinding {
  /** Repository-relative file path. */
  readonly file: string;
  /** 1-based line of the diagnostic. */
  readonly line: number;
  /** 1-based column of the diagnostic. */
  readonly column: number;
  /** Oxlint severity, such as `error` or `warning`. */
  readonly severity: string;
  /** Rule code, such as `typescript(no-non-null-assertion)`. */
  readonly code: string;
  /** Diagnostic message. */
  readonly message: string;
}

const OxlintReport = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      message: Schema.String,
      code: Schema.optionalKey(Schema.String),
      severity: Schema.String,
      filename: Schema.String,
      labels: Schema.Array(
        Schema.Struct({
          span: Schema.Struct({ line: Schema.Finite, column: Schema.Finite }),
        }),
      ),
    }),
  ),
});

/** Parse `git diff --unified=0 --no-prefix` output into added line ranges per file. */
function parseChangedLines(diff: string): Map<string, readonly LineRange[]> {
  const changed = new Map<string, LineRange[]>();
  let current: LineRange[] | null = null;
  let inHeader = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHeader = true;
      current = null;
      continue;
    }

    if (inHeader && line.startsWith("+++ ")) {
      const path = line.slice(4);

      current = path === "/dev/null" ? null : [];

      if (current) changed.set(path, current);
      continue;
    }

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);

    if (!hunk) continue;
    inHeader = false;

    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);

    if (current && count > 0) current.push([start, start + count - 1]);
  }

  return changed;
}

const collectChangedLines = Effect.fn("agentOxlint.collectChangedLines")(
  function* (scope: AgentOxlintChangeScope) {
    const executor = yield* CommandExecutor;

    const git = (args: readonly string[]) =>
      executor
        .run("git", ["-c", "core.quotePath=false", ...args], {
          cwd: process.cwd(),
        })
        .pipe(
          Effect.mapError((error) =>
            commandError(error, "agent-oxlint: could not read changes"),
          ),
        );

    const amend = scope.kind !== "worktree" && scope.amend;

    const base = yield* git([
      "rev-parse",
      "--verify",
      "--quiet",
      amend ? "HEAD^" : "HEAD",
    ]).pipe(
      Effect.map((output) => output.trim()),
      Effect.orElseSucceed(() => EMPTY_TREE),
    );

    const pathspec = scope.kind === "paths" ? ["--", ...scope.paths] : [];

    const diff = yield* git([
      "diff",
      ...(scope.kind === "staged" ? ["--cached"] : []),
      "--unified=0",
      "--no-color",
      "--no-ext-diff",
      "--no-prefix",
      base,
      ...pathspec,
    ]);

    const changed = new Map<string, readonly LineRange[] | "all">(
      parseChangedLines(diff),
    );

    if (scope.kind !== "staged") {
      const untracked = yield* git([
        "ls-files",
        "--others",
        "--exclude-standard",
        "--full-name",
        ...pathspec,
      ]);

      for (const file of untracked.split("\n")) {
        if (file) changed.set(file, "all");
      }
    }

    return new Map(
      [...changed].filter(
        ([file, ranges]) =>
          LINTABLE_EXTENSIONS.has(extname(file)) &&
          (ranges === "all" || ranges.length > 0),
      ),
    ) satisfies ChangedLines;
  },
);

const lintChangedLines = Effect.fn("agentOxlint.lintChangedLines")(function* (
  root: string,
  cache: AgentOxlintCache,
  scope: AgentOxlintChangeScope,
) {
  const executor = yield* CommandExecutor;
  const changed = yield* collectChangedLines(scope);

  if (changed.size === 0) return [];

  const stdout = yield* executor
    .run(
      cache.binary,
      [
        "--config",
        cache.config,
        "--format",
        "json",
        "--no-error-on-unmatched-pattern",
        ...changed.keys(),
      ],
      { cwd: root },
    )
    .pipe(
      Effect.catchTag("CommandError", (error) =>
        error.exitCode === 1 && error.stdout
          ? Effect.succeed(error.stdout)
          : Effect.fail(commandError(error, "agent-oxlint: Oxlint failed")),
      ),
    );

  const report = yield* Schema.decodeEffect(
    Schema.fromJsonString(OxlintReport),
  )(stdout).pipe(
    Effect.mapError((error) =>
      fail(`agent-oxlint: could not read Oxlint output: ${String(error)}`),
    ),
  );

  return report.diagnostics
    .flatMap((diagnostic): AgentOxlintFinding[] => {
      const ranges = changed.get(diagnostic.filename);

      const label = diagnostic.labels.find(
        ({ span }) =>
          ranges === "all" ||
          ranges?.some(
            ([start, end]) => span.line >= start && span.line <= end,
          ),
      );

      return label
        ? [
            {
              file: diagnostic.filename,
              line: label.span.line,
              column: label.span.column,
              severity: diagnostic.severity,
              code: diagnostic.code ?? "",
              message: diagnostic.message,
            },
          ]
        : [];
    })
    .toSorted(
      (a, b) =>
        a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
    );
});

/** Format a finding as a single `file:line:column severity code message` line. */
export function formatAgentOxlintFinding(finding: AgentOxlintFinding): string {
  return `${finding.file}:${finding.line}:${finding.column} ${finding.severity} ${finding.code} ${finding.message}`;
}

/**
 * Lint only the added or modified lines in scope, applying the same opt-in and
 * repository Oxlint gates as the command. Returns null when the pass is skipped.
 */
export const agentOxlintChangedFindings = Effect.fn(
  "agentOxlint.changedFindings",
)(function* (scope: AgentOxlintChangeScope) {
  const config = yield* Config;
  const root = yield* repositoryRoot();
  const gate = yield* prepareAgentOxlint(root, config.gitConfig, false);

  if (!gate.ready) return null;

  return yield* lintChangedLines(root, gate.cache, scope);
});

/** Run the generic personal Oxlint pass when the current repository opts in or --force is set. */
export const agentOxlint = Effect.fn("agentOxlint")(function* (
  options: AgentOxlintOptions,
) {
  const explicit = options.all || options.paths.length > 0;

  if (options.all && options.paths.length > 0) {
    return yield* fail("agent-oxlint: --all cannot be combined with paths");
  }

  if (options.changed && explicit) {
    return yield* fail(
      "agent-oxlint: --changed cannot be combined with paths or --all",
    );
  }

  if (!options.optIn && !options.changed && !explicit) {
    return yield* fail(
      "agent-oxlint: pass --changed, changed paths, or use --all",
    );
  }

  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;
  let gitConfig = config.gitConfig;
  const root = yield* repositoryRoot();
  const targets = options.all ? ["."] : options.paths;
  const escaped = targets.find((path) => !pathInsideRoot(root, path));

  if (escaped) {
    return yield* fail(
      `agent-oxlint: path is outside the repository: ${escaped}`,
    );
  }

  if (options.optIn) {
    if (!(yield* optInRepository(root))) return;

    if (!options.changed && !explicit) return;
    gitConfig = yield* loadDotGitConfig(config.gitConfig.filePath);
  }

  if (options.force) {
    yield* log.warn(
      "Forcing agent Oxlint: skipping opt-in and repository Oxlint gates (--force)",
    );
  }

  const gate = yield* prepareAgentOxlint(root, gitConfig, options.force);

  if (!gate.ready) {
    if (gate.exitCode === undefined) {
      yield* log.info(gate.reason);
    } else {
      process.exitCode = gate.exitCode;
    }

    return;
  }

  if (options.changed) {
    const findings = yield* lintChangedLines(root, gate.cache, {
      kind: "worktree",
    });

    if (findings.length === 0) {
      yield* log.success("No agent Oxlint findings on changed lines");

      return;
    }

    yield* Effect.sync(() =>
      process.stdout.write(
        `${findings.map(formatAgentOxlintFinding).join("\n")}\n`,
      ),
    );

    const errors = findings.filter(
      (finding) => finding.severity === "error",
    ).length;

    yield* log.warn(
      `${plural(findings.length, "finding")} on changed lines (${plural(errors, "error")})`,
    );
    process.exitCode = 1;

    return;
  }

  const lintExit = yield* executor.inherit(
    gate.cache.binary,
    ["--config", gate.cache.config, ...targets],
    { cwd: root },
  );

  if (lintExit !== 0) process.exitCode = lintExit;
});
