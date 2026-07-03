/**
 * @file Forces read-only primary agents to delegate only to non-modifying subagents.
 *
 * Built-in `general` / Cursor-style `generalPurpose` subagent types are
 * rewritten to `general-readonly` when the delegating agent is read-only.
 * The tool result is annotated so the agent can see why its delegation changed,
 * and the reroute is toasted to the interactive session.
 * `general-readonly` bash calls are also restricted to simple inspection
 * commands so allowlisted commands cannot be turned into file writes.
 *
 * Dotfiles agents under agents/.config/opencode/agents (audit):
 * - grill, reviewer, ask, general-readonly, researcher — deny edit and write on normal paths → guarded
 * - build-locked — edit allow, write deny (can change existing files) → not read-only
 * - build-ask — edit/write ask → not read-only
 * - refactorer — sparse permission front matter (inherits writable defaults) → not read-only
 *
 * OpenCode native `plan` denies typical source probes but is allowed to delegate
 * implementation work, so it is excluded here.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { showToast } from "../lib/toast";

type OpenCodeClient = Parameters<Plugin>[0]["client"];
type PermissionAction = "allow" | "ask" | "deny";

interface PermissionRule {
  readonly permission: string;
  readonly pattern: string;
  readonly action: PermissionAction;
}

interface AgentDefinition {
  readonly name: string;
  readonly options?: Record<string, unknown>;
  readonly permission: readonly PermissionRule[];
}

interface DirectoryQuery {
  readonly directory: string;
}

interface DelegationRewriteNotice {
  readonly parentAgent: string;
  readonly requested: string;
  readonly replacement: string;
}

/** Agents that match read-only probes but must still be allowed writable subagents */
const DELEGATION_READONLY_EXCEPTIONS = new Set(["plan"]);

const READONLY_GENERAL_AGENT = "general-readonly";

const WRITABLE_GENERAL_ALIASES = new Set(["general", "generalPurpose"]);

const EDIT_PROBE_PATH = "src/__readonly_subagent_probe__.ts";
const WRITE_PROBE_PATH = "src/__readonly_subagent_new__.ts";

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function dataOrValue(value: unknown): unknown {
  const record = recordFromUnknown(value);
  return "data" in record && record.data !== undefined ? record.data : value;
}

function argRecord(value: unknown): Record<string, unknown> {
  return recordFromUnknown(value);
}

function permissionAction(value: unknown): PermissionAction {
  return value === "allow" || value === "ask" || value === "deny"
    ? value
    : "ask";
}

function permissionRule(value: unknown): PermissionRule | null {
  const record = recordFromUnknown(value);
  const permission = record.permission;
  const pattern = record.pattern;
  if (typeof permission !== "string" || typeof pattern !== "string")
    return null;
  return { permission, pattern, action: permissionAction(record.action) };
}

function permissionRules(value: unknown): PermissionRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const rule = permissionRule(item);
    return rule ? [rule] : [];
  });
}

function agentDefinition(value: unknown): AgentDefinition | null {
  const record = recordFromUnknown(value);
  if (typeof record.name !== "string") return null;
  const options = recordFromUnknown(record.options);
  return {
    name: record.name,
    options: Object.keys(options).length ? options : undefined,
    permission: permissionRules(record.permission),
  };
}

function agentDefinitions(value: unknown): AgentDefinition[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    const agent = agentDefinition(item);
    return agent ? [agent] : [];
  });
}

function wildcardMatch(str: string, pattern: string): boolean {
  const normalizedStr = str.replaceAll("\\", "/");
  const normalizedPattern = pattern.replaceAll("\\", "/");
  let escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  if (escaped.endsWith(" .*")) {
    escaped = escaped.slice(0, -3) + "( .*)?";
  }
  const flags = process.platform === "win32" ? "si" : "s";
  return new RegExp("^" + escaped + "$", flags).test(normalizedStr);
}

function evaluateAction(
  ruleset: readonly PermissionRule[],
  permission: string,
  pattern: string,
): PermissionAction {
  const matches = ruleset.filter(
    (r) =>
      wildcardMatch(permission, r.permission) &&
      wildcardMatch(pattern, r.pattern),
  );
  const rule = matches[matches.length - 1];
  return rule?.action ?? "ask";
}

/** True when the agent cannot edit or create typical workspace files (last matching rule is deny). */
function readOnlyByWorkspaceProbes(
  ruleset: readonly PermissionRule[],
): boolean {
  return (
    evaluateAction(ruleset, "edit", EDIT_PROBE_PATH) === "deny" &&
    evaluateAction(ruleset, "write", WRITE_PROBE_PATH) === "deny"
  );
}

function allowsOrAsksTypicalWorkspaceEdits(
  ruleset: readonly PermissionRule[],
): boolean {
  const editAction = evaluateAction(ruleset, "edit", EDIT_PROBE_PATH);
  const writeAction = evaluateAction(ruleset, "write", WRITE_PROBE_PATH);
  return (
    editAction === "allow" ||
    editAction === "ask" ||
    writeAction === "allow" ||
    writeAction === "ask"
  );
}

function readonlyBashUnsafeReason(command: string): string | undefined {
  if (/\r|\n/.test(command))
    return "multi-line shell commands are not permitted";
  if (/\$\(|`/.test(command)) return "command substitution is not permitted";
  if (/&&/.test(command)) return "command chaining is not permitted";
  if (/[<>|;]/.test(command))
    return "redirection, pipes, and command chaining are not permitted";
  if (/(^|[^&])&($|[^&])/.test(command))
    return "background shell jobs are not permitted";
  if (/(?:^|\s)--output(?:=|\s|$)/.test(command))
    return "output flags are not permitted";
  return undefined;
}

function shouldEnforceReadonlyDelegation(parent: AgentDefinition): boolean {
  if (DELEGATION_READONLY_EXCEPTIONS.has(parent.name)) return false;
  if (parent.options?.enforce_readonly_subagents === true) return true;
  return readOnlyByWorkspaceProbes(parent.permission);
}

async function resolveDelegatingAgentName(
  client: OpenCodeClient,
  sessionID: string,
  query: DirectoryQuery | undefined,
): Promise<string | undefined> {
  const seen = new Set<string>();
  let sid: string | undefined = sessionID;
  while (sid && !seen.has(sid)) {
    seen.add(sid);
    try {
      const sessionRes = await client.session.get({
        path: { id: sid },
        ...(query ? { query } : {}),
      });
      const session = recordFromUnknown(dataOrValue(sessionRes));
      if (typeof session.agent === "string") return session.agent;
      sid = typeof session.parentID === "string" ? session.parentID : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export const ReadonlySubagentTaskGuard = (async ({ client, directory }) => {
  const query: DirectoryQuery | undefined = directory
    ? { directory }
    : undefined;
  const delegationRewrites = new Map<string, DelegationRewriteNotice>();

  return {
    "tool.execute.before": async (input, output) => {
      const args = argRecord(output.args);

      if (input.tool === "bash") {
        const command = args.command;
        if (typeof command !== "string") return;

        const agentName = await resolveDelegatingAgentName(
          client,
          input.sessionID,
          query,
        );
        if (agentName !== READONLY_GENERAL_AGENT) return;

        const reason = readonlyBashUnsafeReason(command);
        if (reason)
          throw new Error(`general-readonly bash rejected: ${reason}`);
        return;
      }

      if (input.tool !== "task") return;

      const subagentType = args?.subagent_type;
      if (!subagentType || typeof subagentType !== "string") return;

      const parentAgentName = await resolveDelegatingAgentName(
        client,
        input.sessionID,
        query,
      );
      if (!parentAgentName) return;

      let agents: AgentDefinition[] | null;
      try {
        const agentsRes = await client.app.agents(
          query ? { query } : undefined,
        );
        agents = agentDefinitions(dataOrValue(agentsRes));
      } catch {
        return;
      }

      if (!agents) return;

      const parent = agents.find((a) => a.name === parentAgentName);
      const target = agents.find((a) => a.name === subagentType);
      if (!parent || !target) return;

      if (!shouldEnforceReadonlyDelegation(parent)) return;
      if (!allowsOrAsksTypicalWorkspaceEdits(target.permission)) return;

      const readonlyGeneral = agents.find(
        (a) => a.name === READONLY_GENERAL_AGENT,
      );
      if (WRITABLE_GENERAL_ALIASES.has(subagentType) && readonlyGeneral) {
        delegationRewrites.set(input.callID, {
          parentAgent: parent.name,
          requested: subagentType,
          replacement: READONLY_GENERAL_AGENT,
        });
        args.subagent_type = READONLY_GENERAL_AGENT;
        await showToast(client, {
          title: "Delegation rerouted",
          message: `${subagentType} → ${READONLY_GENERAL_AGENT} (${parent.name} is read-only)`,
          variant: "info",
          duration: 5000,
        });
        return;
      }

      throw new Error(
        'Read-only agents cannot delegate to subagents that may modify files. Use subagent_type "general" (routed to read-only general), "explore", or switch to an agent that can edit.',
      );
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool !== "task") return;

      const notice = delegationRewrites.get(input.callID);
      if (!notice) return;
      delegationRewrites.delete(input.callID);

      const message =
        `readonly-subagent-task-guard: subagent_type ${notice.requested} was replaced with ${notice.replacement} because ${notice.parentAgent} is read-only.`;
      output.output = [message, output.output].filter(Boolean).join("\n\n");
      output.metadata = {
        ...recordFromUnknown(output.metadata),
        readonly_subagent_task_guard: notice,
      };
    },
  };
}) satisfies Plugin;

export default ReadonlySubagentTaskGuard;
