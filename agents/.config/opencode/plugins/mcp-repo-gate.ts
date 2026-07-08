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
  fallow: ["package.json"],
  convex: ["convex.json", "convex"],
  "astro-docs": [
    "astro.config.mjs",
    "astro.config.ts",
    "astro.config.mts",
    "astro.config.js",
    "astro.config.cjs",
  ],
  // chrome-devtools is ~27 tools (~4.3k tokens of schema) and only useful for
  // browser/UI work, so gate it behind a frontend signal. Any one marker (a
  // static entry point or a web-framework/bundler config) keeps it loaded,
  // including static sites without a package.json. The tradeoff, agreed
  // deliberately: if you attach DevTools to an arbitrary page from a
  // non-frontend directory, restart OpenCode there to bring the server back
  // (MCP config is not hot-reloaded).
  "chrome-devtools": [
    "index.html",
    "astro.config.mjs",
    "astro.config.ts",
    "astro.config.mts",
    "astro.config.js",
    "astro.config.cjs",
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mjs",
    "vite.config.mts",
    "vite.config.cts",
    "vite.config.cjs",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "nuxt.config.ts",
    "nuxt.config.js",
    "svelte.config.js",
    "vue.config.js",
    "angular.json",
    // Bundlers/task runners that signal a browser build (e.g. Home Assistant
    // frontend uses rspack + gulp). Kept broad on purpose: a false positive
    // only costs tokens in that repo, a false negative hides DevTools where it
    // is wanted.
    "webpack.config.js",
    "webpack.config.cjs",
    "webpack.config.mjs",
    "webpack.config.ts",
    "rspack.config.js",
    "rspack.config.cjs",
    "rspack.config.mjs",
    "rspack.config.ts",
    "rollup.config.js",
    "rollup.config.mjs",
    "rollup.config.ts",
    "gulpfile.js",
    "gulpfile.mjs",
    ".storybook",
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
        }
      }
    },
  }
}) satisfies Plugin
