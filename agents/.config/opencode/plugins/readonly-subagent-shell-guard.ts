/**
 * @file Rejects shell syntax that can turn read-only subagent commands into writes.
 *
 * Agent task permissions now provide delegation boundaries directly. This
 * guard only closes shell syntax escape hatches around the inspection command
 * allowlists used by read-only research agents.
 */

import type { Plugin } from "@opencode-ai/plugin";

type OpenCodeClient = Parameters<Plugin>[0]["client"];

interface DirectoryQuery {
  readonly directory: string;
}

const GUARDED_AGENTS = new Set([
  "general-readonly",
  "researcher",
  "researcher-readonly",
]);

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function dataOrValue(value: unknown): unknown {
  const record = recordFromUnknown(value);
  return "data" in record && record.data !== undefined ? record.data : value;
}

async function sessionAgent(
  client: OpenCodeClient,
  sessionID: string,
  query: DirectoryQuery | undefined,
): Promise<string | undefined> {
  const response = await client.session.get({
    path: { id: sessionID },
    ...(query ? { query } : {}),
  });
  const session = recordFromUnknown(dataOrValue(response));
  return typeof session.agent === "string" ? session.agent : undefined;
}

function unsafeReason(command: string): string | undefined {
  if (/\r|\n/.test(command))
    return "multi-line shell commands are not permitted";
  if (/\$\(|`/.test(command)) return "command substitution is not permitted";
  if (/&&/.test(command)) return "command chaining is not permitted";
  if (/[<>|;]/.test(command))
    return "redirection, pipes, and command chaining are not permitted";
  if (/(^|[^&])&($|[^&])/.test(command))
    return "background shell jobs are not permitted";
  if (/(?:^|\s)--(?:out|output)(?:=|\s|$)/.test(command))
    return "output flags are not permitted";
  return undefined;
}

export const ReadonlySubagentShellGuard = (async ({ client, directory }) => {
  const query: DirectoryQuery | undefined = directory
    ? { directory }
    : undefined;

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return;

      const command = recordFromUnknown(output.args).command;
      if (typeof command !== "string") return;

      let agent: string | undefined;
      try {
        agent = await sessionAgent(client, input.sessionID, query);
      } catch {
        throw new Error(
          "Read-only shell command rejected: could not verify the current agent",
        );
      }
      if (!agent || !GUARDED_AGENTS.has(agent)) return;

      const reason = unsafeReason(command);
      if (reason) throw new Error(`${agent} bash rejected: ${reason}`);
    },
  };
}) satisfies Plugin;

export default ReadonlySubagentShellGuard;
