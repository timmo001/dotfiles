/**
 * @file Claude Code MCP sync.
 *
 * ~/.claude.json is live runtime state that Claude Code rewrites, so it is
 * never written directly. User-scope servers are read from it to diff against
 * the spec, then changed through `claude mcp add-json` and `claude mcp remove`.
 * Only servers named in the spec are touched; anything added by hand stays.
 */
import { Effect, Option, Schema } from "effect";
import { join } from "path";
import { readTextOrNull } from "../../lib/fsProbe.js";
import { HOME_DIR } from "../../lib/paths.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { OutputLog } from "../../services/OutputLog.js";
import { buildMcpEntries } from "./adapters.js";
import type { McpSyncSpec } from "./spec.js";

const CLAUDE_STATE = join(HOME_DIR, ".claude.json");

const decodeUserServers = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      mcpServers: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
    }),
  ),
);

/** Counts of user-scope Claude Code servers changed by a sync. */
export interface ClaudeMcpSyncResult {
  /** Servers added or replaced. */
  readonly added: number;
  /** Servers removed because the spec disables them for Claude Code. */
  readonly removed: number;
  /** Servers enabled for Claude Code in the spec. */
  readonly enabled: number;
}

/**
 * Bring Claude Code's user-scope MCP servers in line with the spec.
 *
 * @returns Change counts, or `null` when the `claude` CLI is not installed.
 */
export const syncClaudeMcp = Effect.fn("McpSync.claude")(function* (
  spec: McpSyncSpec,
) {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  if (Bun.which("claude") === null) return null;

  const current: Readonly<Record<string, Schema.Json>> = Option.match(
    decodeUserServers((yield* readTextOrNull(CLAUDE_STATE)) ?? ""),
    {
      onNone: () => ({}),
      onSome: (state) => state.mcpServers ?? {},
    },
  );

  const desired = buildMcpEntries(spec, "claude");
  let added = 0;
  let removed = 0;

  const claude = (args: readonly string[]) =>
    executor.run("claude", ["mcp", ...args], { mergeStderr: true }).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        log
          .warn(`claude mcp ${args[0]} failed: ${error.message}`)
          .pipe(Effect.as(false)),
      ),
    );

  for (const { name } of spec.servers) {
    const existing = current[name];
    const entry = desired[name];

    if (existing !== undefined && Bun.deepEquals(existing, entry)) continue;

    if (existing !== undefined) {
      if (!(yield* claude(["remove", "--scope", "user", name]))) continue;

      if (entry === undefined) removed++;
    }

    if (entry === undefined) continue;

    if (
      yield* claude([
        "add-json",
        "--scope",
        "user",
        name,
        JSON.stringify(entry),
      ])
    )
      added++;
  }

  const result: ClaudeMcpSyncResult = {
    added,
    removed,
    enabled: Object.keys(desired).length,
  };

  return result;
});
