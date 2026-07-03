/**
 * @file Per-repo MCP server gating for OpenCode.
 *
 * Some MCP servers are only useful in repos with a matching marker file. This
 * plugin prunes those servers from the merged config at startup when their
 * marker is absent, so their tools do not load into sessions where they are
 * irrelevant. It is deliberately conservative: only servers listed in
 * {@link REPO_REQUIRED_FILE} are ever removed, and only when the marker is not
 * found from the project directory up to the filesystem root. Every other
 * server is left untouched, so tools are never hidden where they might be
 * wanted.
 *
 * Mutating `cfg.mcp` in the `config` hook is verified to prevent the server
 * loading: the hook runs on the shared merged config before MCP reads it.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * Server name to the marker file that must exist (in the project directory or
 * any ancestor) for the server to load. Servers absent from this map are never
 * gated.
 */
const REPO_REQUIRED_FILE: Record<string, string> = {
  pitchfork: "pitchfork.toml",
}

/** Whether `fileName` exists in `startDir` or any ancestor directory. */
function hasFileUpward(startDir: string, fileName: string): boolean {
  let dir = startDir
  for (;;) {
    if (existsSync(join(dir, fileName))) return true
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

export const McpRepoGate = (async ({ directory }) => {
  const baseDir = directory || process.cwd()
  return {
    config: async (cfg) => {
      const mcp = cfg.mcp
      if (!mcp) return
      for (const [server, requiredFile] of Object.entries(REPO_REQUIRED_FILE)) {
        if (mcp[server] && !hasFileUpward(baseDir, requiredFile)) {
          delete mcp[server]
          console.error(
            `[mcp-repo-gate] pruned "${server}" (no ${requiredFile} in ${baseDir} or ancestors)`,
          )
        }
      }
    },
  }
}) satisfies Plugin
