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

/** Build stable picker options from notification-watched repositories. */
export function captureRepositoryOptions(
  repositories: readonly GitManagedRepo[],
): readonly CaptureRepositoryOption[] {
  return repositories
    .filter(({ notifications }) => notifications.enabled)
    .map(({ name, github }) => ({ label: name, repository: github }))
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
    );
}

/** Merge generated picker options into an existing Wrangler configuration. */
export function mergeCaptureRepositories(
  source: string,
  repositories: readonly CaptureRepositoryOption[],
  live?: LiveCaptureConfig,
): string {
  const parsed: unknown = Bun.JSONC.parse(source);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Wrangler configuration is not an object");
  }
  const config = parsed as Record<string, unknown>;
  const existingVars = config.vars;
  if (
    existingVars !== undefined &&
    (existingVars === null ||
      typeof existingVars !== "object" ||
      Array.isArray(existingVars))
  ) {
    throw new Error("Wrangler vars configuration is not an object");
  }
  return `${JSON.stringify(
    {
      ...config,
      ...(live
        ? {
            compatibility_date: live.compatibilityDate,
            compatibility_flags: live.compatibilityFlags,
            kv_namespaces: live.kvNamespaces,
          }
        : {}),
      vars: {
        ...(live?.vars ??
          (existingVars as Record<string, unknown> | undefined)),
        CAPTURE_REPOSITORIES: JSON.stringify(repositories),
      },
    },
    null,
    2,
  )}\n`;
}

/** Decode the active deployment and return its version identifier. */
export function activeVersionId(source: string): string {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Deployment status is not an object");
  }
  const versions = (parsed as Record<string, unknown>).versions;
  if (!Array.isArray(versions)) throw new Error("Deployment has no versions");
  const active = versions.find(
    (version) =>
      version !== null &&
      typeof version === "object" &&
      (version as Record<string, unknown>).percentage === 100,
  );
  const versionId = active && (active as Record<string, unknown>).version_id;
  if (typeof versionId !== "string") {
    throw new Error("Deployment has no active version");
  }
  return versionId;
}

/** Convert Wrangler's active version details into a non-secret local config. */
export function liveCaptureConfig(source: string): LiveCaptureConfig {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Worker version is not an object");
  }
  const resources = (parsed as Record<string, unknown>).resources;
  if (!resources || typeof resources !== "object") {
    throw new Error("Worker version has no resources");
  }
  const record = resources as Record<string, unknown>;
  const runtime = record.script_runtime;
  if (!runtime || typeof runtime !== "object") {
    throw new Error("Worker version has no runtime settings");
  }
  const runtimeRecord = runtime as Record<string, unknown>;
  const compatibilityDate = runtimeRecord.compatibility_date;
  const compatibilityFlags = runtimeRecord.compatibility_flags;
  if (
    typeof compatibilityDate !== "string" ||
    !Array.isArray(compatibilityFlags) ||
    !compatibilityFlags.every((flag) => typeof flag === "string")
  ) {
    throw new Error("Worker compatibility settings are invalid");
  }

  const vars: Record<string, string> = {};
  const kvNamespaces: { binding: string; id: string }[] = [];
  const bindings = record.bindings;
  if (!Array.isArray(bindings)) throw new Error("Worker bindings are invalid");
  for (const binding of bindings) {
    if (!binding || typeof binding !== "object") continue;
    const value = binding as Record<string, unknown>;
    if (
      value.type === "plain_text" &&
      typeof value.name === "string" &&
      typeof value.text === "string"
    ) {
      vars[value.name] = value.text;
    } else if (
      value.type === "kv_namespace" &&
      typeof value.name === "string" &&
      typeof value.namespace_id === "string"
    ) {
      kvNamespaces.push({ binding: value.name, id: value.namespace_id });
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
