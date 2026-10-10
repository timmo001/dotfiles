/**
 * @file `dot agent permission hook`: enforce OpenCode permissions in Claude Code.
 *
 * Runs as a Claude Code `PreToolUse` hook. It maps the tool call onto the
 * matching OpenCode actions, evaluates the rules from the stowed OpenCode
 * config with OpenCode's own semantics, and answers allow, ask or deny. When
 * no rule decides, it prints nothing so Claude Code's own prompting applies.
 * Any failure also falls back to Claude Code's defaults rather than blocking.
 */
import { Effect, Option, Schema } from "effect";
import { join } from "path";
import { readTextOrNull } from "../lib/fsProbe.js";
import {
  evaluatePermissions,
  isExternalPath,
  pathSpellings,
  splitShellCommands,
  type PermissionRequest,
} from "../lib/opencodePermissions.js";
import { CONFIG_DIR } from "../lib/paths.js";
import { isString } from "../lib/schema.js";

const OPENCODE_CONFIG = join(CONFIG_DIR, "opencode", "opencode.json");

const decodeRules = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      permissions: Schema.optional(
        Schema.Array(
          Schema.Struct({
            action: Schema.String,
            resource: Schema.String,
            effect: Schema.Literals(["allow", "ask", "deny"]),
          }),
        ),
      ),
    }),
  ),
);

const decodeHookInput = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      cwd: Schema.String,
      tool_name: Schema.String,
      tool_input: Schema.Record(Schema.String, Schema.Json),
    }),
  ),
);

/** Requests for a tool that reads or writes a path. */
function pathRequests(
  action: "read" | "edit",
  path: string,
  cwd: string,
): PermissionRequest[] {
  const spellings = pathSpellings(path, cwd);
  const requests: PermissionRequest[] = [{ action, resources: [spellings] }];

  if (isExternalPath(path, cwd))
    requests.push({ action: "external_directory", resources: [spellings] });

  return requests;
}

/** Map a Claude Code tool call onto OpenCode permission requests. */
function toolRequests(
  tool: string,
  input: Readonly<Record<string, Schema.Json>>,
  cwd: string,
): PermissionRequest[] {
  const text = (key: string) => {
    const value = input[key];

    return isString(value) ? value : null;
  };

  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);

  if (mcp !== null) {
    const server = (mcp[1] ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");

    return [{ action: `${server}_${mcp[2] ?? ""}`, resources: [["*"]] }];
  }

  switch (tool) {
    case "Bash": {
      const command = text("command");

      return command === null
        ? []
        : [
            {
              action: "shell",
              resources: splitShellCommands(command).map((part) => [part]),
            },
          ];
    }

    case "Read": {
      const path = text("file_path");

      return path === null ? [] : pathRequests("read", path, cwd);
    }

    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit": {
      const path = text("file_path") ?? text("notebook_path");

      return path === null ? [] : pathRequests("edit", path, cwd);
    }

    case "Glob":
    case "Grep": {
      const path = text("path");

      return path === null || !isExternalPath(path, cwd)
        ? []
        : [
            {
              action: "external_directory",
              resources: [pathSpellings(path, cwd)],
            },
          ];
    }

    case "WebFetch":
      return [{ action: "webfetch", resources: [[text("url") ?? "*"]] }];
    case "WebSearch":
      return [{ action: "websearch", resources: [[text("query") ?? "*"]] }];
    case "TodoWrite":
      return [{ action: "todowrite", resources: [["*"]] }];
    default:
      return [];
  }
}

/** Read a `PreToolUse` event from stdin and print the hook decision, if any. */
export const claudePermissionHook = Effect.gen(function* () {
  const event = decodeHookInput(yield* Effect.promise(() => Bun.stdin.text()));

  if (Option.isNone(event)) return;

  const config = decodeRules((yield* readTextOrNull(OPENCODE_CONFIG)) ?? "");
  const rules = Option.isSome(config) ? (config.value.permissions ?? []) : [];

  const { cwd, tool_name, tool_input } = event.value;

  const decision = evaluatePermissions(
    rules,
    toolRequests(tool_name, tool_input, cwd),
  );

  if (decision === null) return;

  yield* Effect.sync(() => {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: decision.effect,
          permissionDecisionReason: decision.reason,
        },
      })}\n`,
    );
  });
}).pipe(Effect.withSpan("ClaudePermissionHook"));
