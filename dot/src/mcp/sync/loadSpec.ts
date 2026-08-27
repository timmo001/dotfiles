/**
 * @file Load and validate the private MCP sync YAML spec.
 *
 * Mirrors the loader style of {@link file://./../../services/GitConfig.ts}:
 * strict-ish validation into a typed spec with human-readable diagnostics, and
 * an empty-config fallback when the private file is absent.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Schema } from "effect";
import { displayPath } from "../../lib/paths.js";
import {
  decodeJson,
  formatCause,
  isBoolean,
  isJsonObject,
  isNumber,
  isString,
  type JsonObject,
  type JsonValue,
} from "../../lib/schema.js";
import {
  MCP_HARNESSES,
  type McpHarness,
  type McpOAuthSpec,
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
const OAUTH_KEYS = new Set([
  "client_id",
  "client_secret",
  "scope",
  "callback_port",
  "redirect_uri",
]);
const HARNESS_IDS = new Set<string>(MCP_HARNESSES);
const isMcpHarness = Schema.is(
  Schema.Union(MCP_HARNESSES.map((harness) => Schema.Literal(harness))),
);

interface MutableMcpServerSpec {
  name: string;
  type: "local" | "remote";
  command?: readonly string[];
  url?: string;
  headers?: Readonly<Record<string, string>>;
  env?: Readonly<Record<string, string>>;
  oauth?: boolean | McpOAuthSpec;
  gated: boolean;
  enabled: Readonly<Partial<Record<McpHarness, boolean>>>;
  overrides?: Readonly<Partial<Record<McpHarness, McpServerOverride>>>;
}

interface MutableMcpOAuthSpec {
  client_id?: string;
  client_secret?: string;
  scope?: string;
  callback_port?: number;
  redirect_uri?: string;
}

interface MutableMcpServerOverride {
  command?: readonly string[];
  url?: string;
}

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
    const parsed = decodeJson(Bun.YAML.parse(readFileSync(filePath, "utf-8")));
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
  value: JsonValue,
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
  value: JsonValue,
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
  const oauth = parseOAuth(value.oauth, `${location}.oauth`, diagnostics);
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
  const server: MutableMcpServerSpec = { name, type, gated, enabled };
  if (command) server.command = command;
  if (url) server.url = url;
  if (headers) server.headers = headers;
  if (env) server.env = env;
  if (oauth !== null) server.oauth = oauth;
  if (overrides) server.overrides = overrides;
  return [server];
}

function parseType(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): "local" | "remote" | null {
  if (value === "local" || value === "remote") return value;
  diagnostics.push(`${location} must be "local" or "remote"`);
  return null;
}

function parseCommand(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): readonly string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((item) => !isString(item))) {
    diagnostics.push(`${location} must be an array of strings`);
    return null;
  }
  return value;
}

function parseStringMap(
  value: JsonValue,
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
    if (!isString(entry)) {
      diagnostics.push(`${location}.${key} must be a string`);
      continue;
    }
    result[key] = entry;
  }
  return Object.keys(result).length === 0 ? null : result;
}

function parseOAuth(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): boolean | McpOAuthSpec | null {
  if (value === undefined) return null;
  if (isBoolean(value)) return value;
  if (!isRecord(value)) {
    diagnostics.push(`${location} must be true, false, or an object`);
    return null;
  }

  pushUnknownKeyDiagnostics(diagnostics, value, OAUTH_KEYS, location);
  const clientId = optionalString(
    value.client_id,
    `${location}.client_id`,
    diagnostics,
  );
  const clientSecret = optionalString(
    value.client_secret,
    `${location}.client_secret`,
    diagnostics,
  );
  const scope = optionalString(value.scope, `${location}.scope`, diagnostics);
  const redirectUri = optionalString(
    value.redirect_uri,
    `${location}.redirect_uri`,
    diagnostics,
  );
  const callbackPort = parseCallbackPort(
    value.callback_port,
    `${location}.callback_port`,
    diagnostics,
  );
  const oauth: MutableMcpOAuthSpec = {};
  if (clientId) oauth.client_id = clientId;
  if (clientSecret) oauth.client_secret = clientSecret;
  if (scope) oauth.scope = scope;
  if (callbackPort !== null) oauth.callback_port = callbackPort;
  if (redirectUri) oauth.redirect_uri = redirectUri;
  return oauth;
}

function parseCallbackPort(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): number | null {
  if (value === undefined) return null;
  if (
    !isNumber(value) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65_535
  ) {
    diagnostics.push(`${location} must be an integer from 1 to 65535`);
    return null;
  }
  return value;
}

function parseEnabled(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): Readonly<Partial<Record<McpHarness, boolean>>> | null {
  if (!isRecord(value)) {
    diagnostics.push(`${location} must be an object`);
    return null;
  }
  const result: Partial<Record<McpHarness, boolean>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!HARNESS_IDS.has(key) || !isMcpHarness(key)) {
      diagnostics.push(`${location}.${key} is not an active harness`);
      continue;
    }
    if (!isBoolean(entry)) {
      diagnostics.push(`${location}.${key} must be true or false`);
      continue;
    }
    result[key] = entry;
  }
  return result;
}

function parseOverrides(
  value: JsonValue,
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
    if (!HARNESS_IDS.has(key) || !isMcpHarness(key)) {
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
    const override: MutableMcpServerOverride = {};
    if (command) override.command = command;
    if (url) override.url = url;
    result[key] = override;
  }
  return Object.keys(result).length === 0 ? null : result;
}

function requiredString(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): string | null {
  if (!isString(value) || value.trim().length === 0) {
    diagnostics.push(`${location} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function optionalString(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): string | null {
  if (value === undefined) return null;
  if (!isString(value) || value.trim().length === 0) {
    diagnostics.push(`${location} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function requiredBoolean(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): boolean | null {
  if (!isBoolean(value)) {
    diagnostics.push(`${location} must be true or false`);
    return null;
  }
  return value;
}

function pushUnknownKeyDiagnostics(
  diagnostics: string[],
  record: JsonObject,
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

const formatError = formatCause;
const isRecord = isJsonObject;
