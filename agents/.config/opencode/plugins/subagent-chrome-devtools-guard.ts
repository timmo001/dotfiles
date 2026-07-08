/**
 * @file Blocks Chrome DevTools tools from delegated subagent sessions.
 *
 * DevTools can execute arbitrary browser-context JavaScript, so keep it as a
 * top-level browser/UI debugging tool rather than a subagent research escape
 * hatch around web, GitHub, or file-reading tools.
 */

import type { Plugin } from "@opencode-ai/plugin"

type OpenCodeClient = Parameters<Plugin>[0]["client"]

interface DirectoryQuery {
  readonly directory: string
}

const CHROME_DEVTOOLS_TOOL_PREFIXES = [
  "chrome-devtools_",
  "chrome_devtools_",
] as const

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

function dataOrValue(value: unknown): unknown {
  const record = recordFromUnknown(value)
  return "data" in record && record.data !== undefined ? record.data : value
}

function isChromeDevToolsTool(tool: string): boolean {
  return CHROME_DEVTOOLS_TOOL_PREFIXES.some((prefix) => tool.startsWith(prefix))
}

async function isSubagentSession(
  client: OpenCodeClient,
  sessionID: string,
  query: DirectoryQuery | undefined,
): Promise<boolean> {
  const result = await client.session.get({
    path: { id: sessionID },
    ...(query ? { query } : {}),
  })
  const session = recordFromUnknown(dataOrValue(result))
  return typeof session.parentID === "string" && session.parentID.length > 0
}

export const SubagentChromeDevtoolsGuard = (async ({ client, directory }) => {
  const query: DirectoryQuery | undefined = directory
    ? { directory }
    : undefined

  return {
    "tool.execute.before": async (input) => {
      if (!isChromeDevToolsTool(input.tool)) return

      let isSubagent: boolean
      try {
        isSubagent = await isSubagentSession(client, input.sessionID, query)
      } catch {
        throw new Error(
          "Chrome DevTools tools are only allowed from top-level sessions; could not verify the current session.",
        )
      }

      if (!isSubagent) return

      throw new Error(
        "Chrome DevTools tools are only allowed from top-level sessions for browser/UI debugging. Subagents must use webfetch, websearch, GitHub tools, or repository reads for research.",
      )
    },
  }
}) satisfies Plugin

export default SubagentChromeDevtoolsGuard
