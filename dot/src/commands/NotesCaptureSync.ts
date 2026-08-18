import { Effect, Schema } from "effect";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { displayPath } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import type { GitManagedRepo } from "../services/GitConfig.js";
import { OutputLog } from "../services/OutputLog.js";

const NOTES_REPOSITORY = "timmo001/notes";
const CAPTURE_CONFIG_PATH = join("capture", "wrangler.local.jsonc");
const CAPTURE_CONFIG_TEMPLATE_PATH = join("capture", "wrangler.deploy.jsonc");
const CAPTURE_REPOSITORY_PRIORITY = [
  "Dotfiles",
  "Skills",
  "Notes",
  "Context",
  "Workflows",
];

const JsonObject = Schema.Record(Schema.String, Schema.Json);
const WranglerConfig = Schema.Struct({ vars: Schema.optional(JsonObject) });
const DeploymentStatus = Schema.Struct({
  versions: Schema.Array(
    Schema.Struct({ percentage: Schema.Number, version_id: Schema.String }),
  ),
});
const WorkerVersion = Schema.Struct({
  resources: Schema.Struct({
    script_runtime: Schema.Struct({
      compatibility_date: Schema.String,
      compatibility_flags: Schema.Array(Schema.String),
    }),
    bindings: Schema.Array(JsonObject),
  }),
});

/** Repository picker record consumed by the notes capture application. */
export interface CaptureRepositoryOption {
  /** Friendly repository label. */
  readonly label: string;
  /** Normalised GitHub owner/repository identifier. */
  readonly repository: string;
}

interface LiveCaptureConfig {
  readonly compatibilityDate: string;
  readonly compatibilityFlags: readonly string[];
  readonly vars: Readonly<Record<string, string>>;
  readonly kvNamespaces: readonly {
    readonly binding: string;
    readonly id: string;
  }[];
}

class NotesCaptureSyncError extends Schema.TaggedErrorClass<NotesCaptureSyncError>()(
  "NotesCaptureSyncError",
  { message: Schema.String },
) {}

/** Build picker options with core tooling first, then private config order. */
export function captureRepositoryOptions(
  repositories: readonly GitManagedRepo[],
): readonly CaptureRepositoryOption[] {
  const enabled = repositories.filter(
    ({ notifications }) => notifications.enabled,
  );
  return [
    ...CAPTURE_REPOSITORY_PRIORITY.flatMap((name) =>
      enabled.filter((repository) => repository.name === name),
    ),
    ...enabled.filter(
      ({ name }) => !CAPTURE_REPOSITORY_PRIORITY.includes(name),
    ),
  ].map(({ name, github }) => ({ label: name, repository: github }));
}

/** Merge generated picker options into an existing Wrangler configuration. */
export function mergeCaptureRepositories(
  source: string,
  repositories: readonly CaptureRepositoryOption[],
  live?: LiveCaptureConfig,
): string {
  const config = Schema.decodeUnknownSync(JsonObject)(Bun.JSONC.parse(source));
  let existing: typeof WranglerConfig.Type;
  try {
    existing = Schema.decodeUnknownSync(WranglerConfig)(config);
  } catch {
    throw new Error("Wrangler vars configuration is not an object");
  }
  const merged = { ...config };
  if (live) {
    merged.compatibility_date = live.compatibilityDate;
    merged.compatibility_flags = [...live.compatibilityFlags];
    merged.kv_namespaces = [...live.kvNamespaces];
  }
  merged.vars = {
    ...(live?.vars ?? existing.vars),
    CAPTURE_REPOSITORIES: JSON.stringify(repositories),
  };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/** Decode the active deployment and return its version identifier. */
export function activeVersionId(source: string): string {
  const deployment = Schema.decodeUnknownSync(DeploymentStatus)(
    JSON.parse(source),
  );
  const versionId = deployment.versions.find(
    ({ percentage }) => percentage === 100,
  )?.version_id;
  if (!versionId) {
    throw new Error("Deployment has no active version");
  }
  return versionId;
}

/** Convert Wrangler's active version details into a non-secret local config. */
export function liveCaptureConfig(source: string): LiveCaptureConfig {
  const { resources } = Schema.decodeUnknownSync(WorkerVersion)(
    JSON.parse(source),
  );
  const compatibilityDate = resources.script_runtime.compatibility_date;
  const compatibilityFlags = resources.script_runtime.compatibility_flags;

  const vars: Record<string, string> = {};
  const kvNamespaces: { binding: string; id: string }[] = [];
  for (const binding of resources.bindings) {
    const plainText = Schema.decodeUnknownOption(
      Schema.Struct({
        type: Schema.Literal("plain_text"),
        name: Schema.String,
        text: Schema.String,
      }),
    )(binding);
    if (plainText._tag === "Some") {
      vars[plainText.value.name] = plainText.value.text;
      continue;
    }
    const kvNamespace = Schema.decodeUnknownOption(
      Schema.Struct({
        type: Schema.Literal("kv_namespace"),
        name: Schema.String,
        namespace_id: Schema.String,
      }),
    )(binding);
    if (kvNamespace._tag === "Some") {
      kvNamespaces.push({
        binding: kvNamespace.value.name,
        id: kvNamespace.value.namespace_id,
      });
    }
  }
  return {
    compatibilityDate,
    compatibilityFlags,
    vars,
    kvNamespaces,
  };
}

/** Atomically replace a private config while preserving restrictive permissions. */
export function writePrivateConfig(destination: string, content: string): void {
  const temporary = `${destination}.tmp.${process.pid}`;
  const mode = existsSync(destination) ? statSync(destination).mode : 0o600;
  try {
    writeFileSync(temporary, content, { encoding: "utf-8", mode: 0o600 });
    chmodSync(temporary, mode);
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** Regenerate the notes capture picker config from private watched repositories. */
export const notesCaptureSync = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  yield* log.section("Notes Capture Sync");

  if (!config.canUsePrivate) {
    yield* log.warn(`Skipped: ${config.privateReason}`);
    return;
  }
  if (!config.gitConfig.present) {
    yield* log.warn(
      `Skipped (missing config): ${displayPath(config.gitConfig.filePath)}`,
    );
    return;
  }
  if (!config.gitConfig.valid) {
    yield* log.error(
      `Invalid config: ${displayPath(config.gitConfig.filePath)}`,
    );
    for (const diagnostic of config.gitConfig.diagnostics) {
      yield* log.error(`  ${diagnostic}`);
    }
    return yield* new NotesCaptureSyncError({
      message: `Invalid git config: ${displayPath(config.gitConfig.filePath)}`,
    });
  }

  const notes = config.gitConfig.repositories.find(
    ({ github }) => github.toLowerCase() === NOTES_REPOSITORY,
  );
  if (!notes) {
    yield* log.warn(`Skipped (unmanaged repository): ${NOTES_REPOSITORY}`);
    return;
  }

  const destination = join(notes.path, CAPTURE_CONFIG_PATH);
  const template = join(notes.path, CAPTURE_CONFIG_TEMPLATE_PATH);
  if (!existsSync(destination) && !existsSync(template)) {
    yield* log.warn(`Skipped (missing template): ${displayPath(template)}`);
    return;
  }

  const repositories = captureRepositoryOptions(config.gitConfig.repositories);
  const captureDirectory = join(notes.path, "capture");
  const deployment = yield* executor.run(
    "bunx",
    ["wrangler", "deployments", "status", "--name", "notes-capture", "--json"],
    { cwd: captureDirectory },
  );
  const versionId = yield* Effect.try({
    try: () => activeVersionId(deployment),
    catch: (error) =>
      new NotesCaptureSyncError({
        message: `Could not identify the active notes-capture version: ${String(error)}`,
      }),
  });
  const version = yield* executor.run(
    "bunx",
    [
      "wrangler",
      "versions",
      "view",
      versionId,
      "--name",
      "notes-capture",
      "--json",
    ],
    { cwd: captureDirectory },
  );
  const live = yield* Effect.try({
    try: () => liveCaptureConfig(version),
    catch: (error) =>
      new NotesCaptureSyncError({
        message: `Could not decode live notes-capture settings: ${String(error)}`,
      }),
  });
  const output = yield* Effect.try({
    try: () =>
      mergeCaptureRepositories(
        readFileSync(existsSync(destination) ? destination : template, "utf-8"),
        repositories,
        live,
      ),
    catch: (error) =>
      new NotesCaptureSyncError({
        message: `Invalid Wrangler config ${displayPath(destination)}: ${String(error)}`,
      }),
  });
  yield* Effect.try({
    try: () => writePrivateConfig(destination, output),
    catch: (error) =>
      new NotesCaptureSyncError({
        message: `Could not write ${displayPath(destination)}: ${String(error)}`,
      }),
  });
  yield* log.info(
    `${repositories.length} repositor${repositories.length === 1 ? "y" : "ies"} -> ${displayPath(destination)}`,
  );

  const liveRepositories = live.vars.CAPTURE_REPOSITORIES;
  const generatedRepositories = JSON.stringify(repositories);
  if (liveRepositories === generatedRepositories) {
    yield* log.info("Live Worker already matches");
    return;
  }

  yield* log.info("Deploying notes-capture...");
  const exitCode = yield* executor.inherit("bun", ["run", "deploy"], {
    cwd: captureDirectory,
  });
  if (exitCode !== 0) {
    return yield* new NotesCaptureSyncError({
      message: `notes-capture deploy failed with exit code ${exitCode}`,
    });
  }
});
