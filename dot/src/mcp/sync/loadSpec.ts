/**
 * @file Load and validate the private MCP sync YAML spec.
 *
 * Mirrors the loader style of {@link file://./../../services/GitConfig.ts}:
 * strict-ish validation into a typed spec with human-readable diagnostics, and
 * an empty-config fallback when the private file is absent.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { displayPath } from "../../lib/paths.js";
import {
  MCP_HARNESSES,
  type McpHarness,
  type McpServerOverride,
  type McpServerSpec,
  type McpSyncSpec,
} from "./spec.js";

const TOP_LEVEL_KEYS = new Set(["schema_version", "servers"]);
const SERVER_KEYS = new Set([
  "name",
  "type",
  "command",
  "url",
  "headers",
  "env",
  "oauth",
  "gated",
  "enabled",
  "overrides",
]);
const OVERRIDE_KEYS = new Set(["command", "url"]);
const HARNESS_IDS = new Set<string>(MCP_HARNESSES);

/** Loaded private MCP sync config and validation diagnostics. */
export interface DotMcpConfig {
  /** Path the config was loaded from. */
  readonly filePath: string;
  /** Whether the YAML file exists. */
  readonly present: boolean;
  /** Whether the YAML file parsed and validated cleanly. */
  readonly valid: boolean;
  /** Normalised spec. Empty when invalid. */
  readonly spec: McpSyncSpec;
  /** Validation diagnostics for missing or malformed config. */
  readonly diagnostics: readonly string[];
}

const EMPTY_SPEC: McpSyncSpec = { servers: [] };

/** Return the default private MCP spec path for a private dotfiles repo. */
export function defaultMcpConfigPath(privateDotfiles: string): string {
  return join(privateDotfiles, "mcp.yml");
}

/** Return an empty MCP config with the supplied availability diagnostics. */
export function emptyMcpConfig(
  filePath: string,
  diagnostics: readonly string[] = [],
): DotMcpConfig {
  return {
    filePath,
    present: false,
    valid: diagnostics.length === 0,
    spec: EMPTY_SPEC,
    diagnostics,
  };
}

/** Load and validate the private MCP sync YAML spec. */
export function loadMcpConfig(filePath: string): DotMcpConfig {
  if (!existsSync(filePath)) {
    return emptyMcpConfig(filePath, [
      `Missing private MCP config: ${displayPath(filePath)}`,
    ]);
  }

  try {
    const parsed = Bun.YAML.parse(readFileSync(filePath, "utf-8")) as unknown;
    const diagnostics: string[] = [];
    const servers = parseSpec(parsed, diagnostics);
    return {
      filePath,
      present: true,
      valid: diagnostics.length === 0,
      spec: diagnostics.length === 0 ? { servers } : EMPTY_SPEC,
      diagnostics,
    };
  } catch (error) {
    return {
      filePath,
      present: true,
      valid: false,
      spec: EMPTY_SPEC,
      diagnostics: [
        `Could not read private MCP config ${displayPath(filePath)}: ${formatError(error)}`,
      ],
    };
  }
}

function parseSpec(
  value: unknown,
  diagnostics: string[],
): readonly McpServerSpec[] {
  if (!isRecord(value)) {
    diagnostics.push("mcp.yml must contain a YAML object");
    return [];
  }

  pushUnknownKeyDiagnostics(diagnostics, value, TOP_LEVEL_KEYS, "root");
  if (value.schema_version !== 1) {
    diagnostics.push("root.schema_version must be 1");
  }
  if (!Array.isArray(value.servers)) {
    diagnostics.push("root.servers must be an array");
    return [];
  }

  const servers = value.servers.flatMap((server, index) =>
    parseServer(server, index, diagnostics),
  );
  pushDuplicateNameDiagnostics(diagnostics, servers);
  return servers;
}

function parseServer(
  value: unknown,
  index: number,
  diagnostics: string[],
): readonly McpServerSpec[] {
  const location = `root.servers[${index}]`;
  if (!isRecord(value)) {
    diagnostics.push(`${location} must be an object`);
    return [];
  }

  pushUnknownKeyDiagnostics(diagnostics, value, SERVER_KEYS, location);
  const name = requiredString(value.name, `${location}.name`, diagnostics);
  const type = parseType(value.type, `${location}.type`, diagnostics);
  const command = parseCommand(
    value.command,
    `${location}.command`,
    diagnostics,
  );
  const url = optionalString(value.url, `${location}.url`, diagnostics);
  const headers = parseStringMap(
    value.headers,
    `${location}.headers`,
    diagnostics,
  );
  const env = parseStringMap(value.env, `${location}.env`, diagnostics);
  const oauth = optionalBoolean(value.oauth, `${location}.oauth`, diagnostics);
  const gated = requiredBoolean(value.gated, `${location}.gated`, diagnostics);
  const enabled = parseEnabled(
    value.enabled,
    `${location}.enabled`,
    diagnostics,
  );
  const overrides = parseOverrides(
    value.overrides,
    `${location}.overrides`,
    diagnostics,
  );

  if (type === "local" && !command) {
    diagnostics.push(`${location}.command is required for local servers`);
  }
  if (type === "remote" && !url) {
    diagnostics.push(`${location}.url is required for remote servers`);
  }

  if (!name || !type || gated === null || !enabled) return [];
  return [
    {
      name,
      type,
      ...(command ? { command } : {}),
      ...(url ? { url } : {}),
      ...(headers ? { headers } : {}),
      ...(env ? { env } : {}),
      ...(oauth === null ? {} : { oauth }),
      gated,
      enabled,
      ...(overrides ? { overrides } : {}),
    },
  ];
}

function parseType(
  value: unknown,
  location: string,
  diagnostics: string[],
): "local" | "remote" | null {
  if (value === "local" || value === "remote") return value;
  diagnostics.push(`${location} must be "local" or "remote"`);
  return null;
}

function parseCommand(
  value: unknown,
  location: string,
  diagnostics: string[],
): readonly string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    diagnostics.push(`${location} must be an array of strings`);
    return null;
  }
  return value as readonly string[];
}

function parseStringMap(
  value: unknown,
  location: string,
  diagnostics: string[],
): Readonly<Record<string, string>> | null {
  if (value === undefined) return null;
  if (!isRecord(value)) {
    diagnostics.push(`${location} must be an object of strings`);
    return null;
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      diagnostics.push(`${location}.${key} must be a string`);
      continue;
    }
    result[key] = entry;
  }
  return Object.keys(result).length === 0 ? null : result;
}

function parseEnabled(
  value: unknown,
  location: string,
  diagnostics: string[],
): Readonly<Partial<Record<McpHarness, boolean>>> | null {
  if (!isRecord(value)) {
    diagnostics.push(`${location} must be an object`);
    return null;
  }
  const result: Partial<Record<McpHarness, boolean>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!HARNESS_IDS.has(key)) {
      diagnostics.push(`${location}.${key} is not an active harness`);
      continue;
    }
    if (typeof entry !== "boolean") {
      diagnostics.push(`${location}.${key} must be true or false`);
      continue;
    }
    result[key as McpHarness] = entry;
  }
  return result;
}

function parseOverrides(
  value: unknown,
  location: string,
  diagnostics: string[],
): Readonly<Partial<Record<McpHarness, McpServerOverride>>> | null {
  if (value === undefined) return null;
  if (!isRecord(value)) {
    diagnostics.push(`${location} must be an object`);
    return null;
  }
  const result: Partial<Record<McpHarness, McpServerOverride>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!HARNESS_IDS.has(key)) {
      diagnostics.push(`${location}.${key} is not an active harness`);
      continue;
    }
    if (!isRecord(entry)) {
      diagnostics.push(`${location}.${key} must be an object`);
      continue;
    }
    pushUnknownKeyDiagnostics(
      diagnostics,
      entry,
      OVERRIDE_KEYS,
      `${location}.${key}`,
    );
    const command = parseCommand(
      entry.command,
      `${location}.${key}.command`,
      diagnostics,
    );
    const url = optionalString(
      entry.url,
      `${location}.${key}.url`,
      diagnostics,
    );
    result[key as McpHarness] = {
      ...(command ? { command } : {}),
      ...(url ? { url } : {}),
    };
  }
  return Object.keys(result).length === 0 ? null : result;
}

function requiredString(
  value: unknown,
  location: string,
  diagnostics: string[],
): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push(`${location} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function optionalString(
  value: unknown,
  location: string,
  diagnostics: string[],
): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push(`${location} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function requiredBoolean(
  value: unknown,
  location: string,
  diagnostics: string[],
): boolean | null {
  if (typeof value !== "boolean") {
    diagnostics.push(`${location} must be true or false`);
    return null;
  }
  return value;
}

function optionalBoolean(
  value: unknown,
  location: string,
  diagnostics: string[],
): boolean | null {
  if (value === undefined) return null;
  if (typeof value !== "boolean") {
    diagnostics.push(`${location} must be true or false`);
    return null;
  }
  return value;
}

function pushUnknownKeyDiagnostics(
  diagnostics: string[],
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key))
      diagnostics.push(`${location}.${key} is not supported`);
  }
}

function pushDuplicateNameDiagnostics(
  diagnostics: string[],
  servers: readonly McpServerSpec[],
): void {
  const seen = new Set<string>();
  for (const server of servers) {
    if (seen.has(server.name))
      diagnostics.push(`Duplicate server name: ${server.name}`);
    seen.add(server.name);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
