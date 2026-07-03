/**
 * @file Per-repo MCP server gating for OpenCode.
 *
 * Some MCP servers are only useful in repos with a matching marker. This plugin
 * prunes those servers from the merged config at startup when none of their
 * markers are present, so their tools do not load into sessions where they are
 * irrelevant. It is deliberately conservative: only servers listed in
 * {@link REPO_REQUIRED_MARKERS} are ever removed, and only when none of their
 * markers are found in the project directory, an ancestor, or a nearby
 * descendant (so a monorepo whose Astro or Convex project sits one or two
 * directories down still keeps the server). Every other server is left
 * untouched, so tools are never hidden where they might be wanted.
 *
 * Mutating `cfg.mcp` in the `config` hook is verified to prevent the server
 * loading: the hook runs on the shared merged config before MCP reads it.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readdirSync, type Dirent } from "node:fs"
import { dirname, join } from "node:path"

/**
 * Server name to the marker files or directories where any one, present in the
 * project directory, an ancestor, or a nearby descendant, keeps the server
 * loaded. Markers can be files or directories (both resolved with `existsSync`).
 * Servers absent from this map are never gated.
 */
const REPO_REQUIRED_MARKERS: Record<string, readonly string[]> = {
  pitchfork: ["pitchfork.toml"],
  convex: ["convex.json", "convex"],
  "astro-docs": [
    "astro.config.mjs",
    "astro.config.ts",
    "astro.config.mts",
    "astro.config.js",
    "astro.config.cjs",
  ],
}

/** Directory names never descended into when scanning downward for a marker. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "target",
])

/** Deepest descendant level scanned downward from the project directory. */
const MAX_DOWN_DEPTH = 2

/** Whether any of `markers` exists directly in `dir`. */
function markerIn(dir: string, markers: readonly string[]): boolean {
  return markers.some((marker) => existsSync(join(dir, marker)))
}

/** Whether any of `markers` exists in `startDir` or an ancestor directory. */
function hasMarkerUpward(startDir: string, markers: readonly string[]): boolean {
  let dir = startDir
  for (;;) {
    if (markerIn(dir, markers)) return true
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

/**
 * Whether any of `markers` exists in a descendant of `startDir` within `depth`
 * levels. Hidden directories and common build/vendor output are skipped so the
 * scan stays cheap and bounded.
 */
function hasMarkerDownward(
  startDir: string,
  markers: readonly string[],
  depth: number,
): boolean {
  if (depth <= 0) return false
  let entries: Dirent[]
  try {
    entries = readdirSync(startDir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) {
      continue
    }
    const child = join(startDir, entry.name)
    if (markerIn(child, markers)) return true
    if (hasMarkerDownward(child, markers, depth - 1)) return true
  }
  return false
}

/** Whether any of `markers` is reachable upward or a short way downward. */
function hasMarkerNearby(baseDir: string, markers: readonly string[]): boolean {
  return (
    hasMarkerUpward(baseDir, markers) ||
    hasMarkerDownward(baseDir, markers, MAX_DOWN_DEPTH)
  )
}

export const McpRepoGate = (async ({ directory }) => {
  const baseDir = directory || process.cwd()
  return {
    config: async (cfg) => {
      const mcp = cfg.mcp
      if (!mcp) return
      for (const [server, markers] of Object.entries(REPO_REQUIRED_MARKERS)) {
        if (mcp[server] && !hasMarkerNearby(baseDir, markers)) {
          delete mcp[server]
          console.error(
            `[mcp-repo-gate] pruned "${server}" (no ${markers.join(" or ")} near ${baseDir})`,
          )
        }
      }
    },
  }
}) satisfies Plugin
