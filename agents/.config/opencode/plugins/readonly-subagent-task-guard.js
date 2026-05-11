/**
 * Forces read-only primary agents to delegate only to subagents that cannot
 * modify workspace files. Built-in `general` / Cursor-style `generalPurpose`
 * are rewritten to `general-readonly` when the invoking session agent is
 * read-only.
 */

const READONLY_PRIMARY_AGENTS = new Set(["reviewer", "ask"])

const WRITABLE_GENERAL_ALIASES = new Set(["general", "generalPurpose"])

const EDIT_PROBE_PATH = "src/__readonly_subagent_probe__.ts"

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

function deniesTypicalWorkspaceEdits(ruleset) {
  return evaluateAction(ruleset, "edit", EDIT_PROBE_PATH) === "deny"
}

function allowsOrAsksTypicalWorkspaceEdits(ruleset) {
  const action = evaluateAction(ruleset, "edit", EDIT_PROBE_PATH)
  return action === "allow" || action === "ask"
}

function shouldEnforceReadonlyDelegation(parent) {
  if (!parent?.name) return false
  if (READONLY_PRIMARY_AGENTS.has(parent.name)) return true
  if (parent.options && parent.options.enforce_readonly_subagents === true) return true
  return false
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
      if (!deniesTypicalWorkspaceEdits(parent.permission)) return
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
