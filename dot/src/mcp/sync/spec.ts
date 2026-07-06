/**
 * @file MCP config sync spec types and pure helpers.
 *
 * A single spec defines every MCP server once, with per-harness enablement and
 * context-gating metadata. Adapters render each active harness's native config
 * from this shape so one edit keeps every harness aligned. The canonical env
 * reference form is `{env:VAR}` (OpenCode's syntax); each adapter rewrites it to
 * the harness's native interpolation.
 */

/** Active harnesses that the generator writes native config files for. */
export type McpHarness = "opencode" | "cursor" | "vscode" | "copilot";

/** Known harnesses that exist but are not generated: documented stubs only. */
export type McpStubHarness = "gemini" | "codex" | "claude";

/** All active harness ids in canonical order. */
export const MCP_HARNESSES: readonly McpHarness[] = [
  "opencode",
  "cursor",
  "vscode",
  "copilot",
];

/** A stub harness with a short explainer of what enabling it would require. */
export interface McpStubHarnessNote {
  /** Stub harness id. */
  readonly harness: McpStubHarness;
  /** Human-readable harness name. */
  readonly label: string;
  /** What it would take to promote this stub to an active, generated harness. */
  readonly note: string;
}

/**
 * Documented "other" harnesses. Kept as first-class stubs so they can be
 * switched on later without re-deriving the shape, per the config-sync design.
 */
export const MCP_STUB_HARNESSES: readonly McpStubHarnessNote[] = [
  {
    harness: "gemini",
    label: "Gemini CLI",
    note: "Would need an `mcpServers` block in ~/.gemini/settings.json using `$VAR` env syntax and `{httpUrl}` for remote servers. The settings file currently exists but carries no MCP block; add a merge adapter and per-server `enabled.gemini` flags to activate.",
  },
  {
    harness: "codex",
    label: "Codex CLI",
    note: "Would need `[mcp_servers.NAME]` TOML tables in ~/.codex/config.toml (`command`/`args` for stdio, an http variant for remote). Add a TOML adapter and per-server `enabled.codex` flags to activate.",
  },
  {
    harness: "claude",
    label: "Claude Code",
    note: "Special case: ~/.claude.json is a live runtime state file Claude rewrites, so it is not stowable or file-generatable. Wire servers with `claude mcp add --scope user NAME -- COMMAND ...` from a setup step rather than emitting a file.",
  },
];

/** Per-harness overrides for a server whose command or url differs by harness. */
export interface McpServerOverride {
  /** Local command override (array form), e.g. OpenCode's `opencode x` runner. */
  readonly command?: readonly string[];
  /** Remote url override. */
  readonly url?: string;
}

/** One MCP server defined once for every harness. */
export interface McpServerSpec {
  /** Canonical server name (also the harness config key). */
  readonly name: string;
  /** Transport type. */
  readonly type: "local" | "remote";
  /** Local stdio command as an argv array. Required when `type` is `local`. */
  readonly command?: readonly string[];
  /** Remote endpoint url. Required when `type` is `remote`. */
  readonly url?: string;
  /** Remote headers with canonical `{env:VAR}` refs. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Local process env with canonical `{env:VAR}` refs. */
  readonly env?: Readonly<Record<string, string>>;
  /** Whether the remote server explicitly disables OAuth (OpenCode only). */
  readonly oauth?: boolean;
  /**
   * Held out of OpenCode's default tools via a `"<name>*": false` gate, so the
   * server is opt-in (invoked by name or command) rather than loaded into every
   * session. This is a manual opt-in gate, not per-repo; repo-scoped gating is
   * handled separately by the mcp-repo-gate plugin.
   */
  readonly gated: boolean;
  /** Per-harness enablement. Absent harness ids default to disabled. */
  readonly enabled: Readonly<Partial<Record<McpHarness, boolean>>>;
  /** Per-harness command/url overrides. */
  readonly overrides?: Readonly<Partial<Record<McpHarness, McpServerOverride>>>;
}

/** The loaded, validated MCP sync spec. */
export interface McpSyncSpec {
  /** Canonical server definitions. */
  readonly servers: readonly McpServerSpec[];
}

/** Whether a server is enabled for a given active harness. */
export function serverEnabledFor(
  server: McpServerSpec,
  harness: McpHarness,
): boolean {
  return server.enabled[harness] === true;
}

/** Servers enabled for a harness, in spec order. */
export function serversForHarness(
  spec: McpSyncSpec,
  harness: McpHarness,
): readonly McpServerSpec[] {
  return spec.servers.filter((server) => serverEnabledFor(server, harness));
}

/** Servers marked opt-in for OpenCode, emitted as `"<name>*": false` tool gates. */
export function gatedOpencodeServers(
  spec: McpSyncSpec,
): readonly McpServerSpec[] {
  return spec.servers.filter(
    (server) => server.gated && serverEnabledFor(server, "opencode"),
  );
}

/** Resolve the effective command for a server on a harness, applying overrides. */
export function resolveCommand(
  server: McpServerSpec,
  harness: McpHarness,
): readonly string[] | undefined {
  return server.overrides?.[harness]?.command ?? server.command;
}

/** Resolve the effective url for a server on a harness, applying overrides. */
export function resolveUrl(
  server: McpServerSpec,
  harness: McpHarness,
): string | undefined {
  return server.overrides?.[harness]?.url ?? server.url;
}

/**
 * Rewrite canonical `{env:VAR}` references in a string to a harness's native
 * interpolation syntax.
 */
export function renderEnvRefs(
  value: string,
  style: "brace-env" | "dollar-brace-env" | "dollar-brace" | "dollar",
): string {
  return value.replace(
    /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, name: string) => {
      switch (style) {
        case "brace-env":
          return `{env:${name}}`;
        case "dollar-brace-env":
          return `\${env:${name}}`;
        case "dollar-brace":
          return `\${${name}}`;
        case "dollar":
          return `$${name}`;
      }
    },
  );
}
