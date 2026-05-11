/**
 * Forces read-only primary agents to delegate only to subagents that cannot
 * modify workspace files. Built-in `general` / Cursor-style `generalPurpose`
 * are rewritten to `general-readonly` when the delegating agent is read-only.
 *
 * Dotfiles agents under agents/.config/opencode/agents (audit):
 * - reviewer, ask, general-readonly — deny edit and write on normal paths → guarded
 * - build-locked — edit allow, write deny (can change existing files) → not read-only
 * - build-ask — edit/write ask → not read-only
 * - refactorer — sparse permission front matter (inherits writable defaults) → not read-only
 *
 * OpenCode native `plan` denies typical source probes but is allowed to delegate
 * implementation work, so it is excluded here.
 */

/** Agents that match read-only probes but must still be allowed writable subagents */
const DELEGATION_READONLY_EXCEPTIONS = new Set(["plan"])

const WRITABLE_GENERAL_ALIASES = new Set(["general", "generalPurpose"])

const EDIT_PROBE_PATH = "src/__readonly_subagent_probe__.ts"
const WRITE_PROBE_PATH = "src/__readonly_subagent_new__.ts"

function wildcardMatch(str, pattern) {
  if (str) str = str.replaceAll("\\", "/")
  if (pattern) pattern = pattern.replaceAll("\\", "/")
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) {
    escaped = escaped.slice(0, -3) + "( .*)?"
  }
  const flags = process.platform === "win32" ? "si" : "s"
  return new RegExp("^" + escaped + "$", flags).test(str)
}

function evaluateAction(ruleset, permission, pattern) {
  const matches = ruleset.filter(
    (r) => wildcardMatch(permission, r.permission) && wildcardMatch(pattern, r.pattern),
  )
  const rule = matches[matches.length - 1]
  return rule?.action ?? "ask"
}

/** True when the agent cannot edit or create typical workspace files (last matching rule is deny). */
function readOnlyByWorkspaceProbes(ruleset) {
  return (
    evaluateAction(ruleset, "edit", EDIT_PROBE_PATH) === "deny" &&
    evaluateAction(ruleset, "write", WRITE_PROBE_PATH) === "deny"
  )
}

function allowsOrAsksTypicalWorkspaceEdits(ruleset) {
  const editAction = evaluateAction(ruleset, "edit", EDIT_PROBE_PATH)
  const writeAction = evaluateAction(ruleset, "write", WRITE_PROBE_PATH)
  return (
    editAction === "allow" ||
    editAction === "ask" ||
    writeAction === "allow" ||
    writeAction === "ask"
  )
}

function shouldEnforceReadonlyDelegation(parent) {
  if (!parent?.name) return false
  if (DELEGATION_READONLY_EXCEPTIONS.has(parent.name)) return false
  if (parent.options && parent.options.enforce_readonly_subagents === true) return true
  return readOnlyByWorkspaceProbes(parent.permission)
}

async function resolveDelegatingAgentName(client, sessionID, query) {
  const seen = new Set()
  let sid = sessionID
  while (sid && !seen.has(sid)) {
    seen.add(sid)
    try {
      const sessionRes = await client.session.get({
        path: { id: sid },
        ...(query ? { query } : {}),
      })
      const session = sessionRes.data ?? sessionRes
      if (session?.agent) return session.agent
      sid = session.parentID
    } catch {
      return undefined
    }
  }
  return undefined
}

export const ReadonlySubagentTaskGuard = async ({ client, directory }) => {
  const query = directory ? { directory } : undefined

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "task") return

      const args = output.args
      const subagentType = args?.subagent_type
      if (!subagentType || typeof subagentType !== "string") return

      const parentAgentName = await resolveDelegatingAgentName(client, input.sessionID, query)
      if (!parentAgentName) return

      let agents
      try {
        const agentsRes = await client.app.agents(query ? { query } : undefined)
        agents = agentsRes.data ?? agentsRes
      } catch {
        return
      }

      if (!Array.isArray(agents)) return

      const parent = agents.find((a) => a.name === parentAgentName)
      const target = agents.find((a) => a.name === subagentType)
      if (!parent || !target) return

      if (!shouldEnforceReadonlyDelegation(parent)) return
      if (!allowsOrAsksTypicalWorkspaceEdits(target.permission)) return

      const readonlyGeneral = agents.find((a) => a.name === "general-readonly")
      if (WRITABLE_GENERAL_ALIASES.has(subagentType) && readonlyGeneral) {
        args.subagent_type = "general-readonly"
        return
      }

      throw new Error(
        "Read-only agents cannot delegate to subagents that may modify files. Use subagent_type \"general\" (routed to read-only general), \"explore\", or switch to an agent that can edit.",
      )
    },
  }
}
