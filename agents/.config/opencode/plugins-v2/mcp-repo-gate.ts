import { Plugin } from "@opencode-ai/plugin/effect";
import { Effect, Result } from "effect";
import { existsSync, readdirSync, type Dirent } from "node:fs";
import { dirname, join } from "node:path";

export const GATED_SERVERS = [
  "pitchfork",
  "convex",
  "astro-docs",
  "chrome-devtools",
] as const;

export type GatedServer = (typeof GATED_SERVERS)[number];

export const REPO_REQUIRED_MARKERS = {
  pitchfork: ["pitchfork.toml"],
  convex: ["convex.json", "convex"],
  "astro-docs": [
    "astro.config.mjs",
    "astro.config.ts",
    "astro.config.mts",
    "astro.config.js",
    "astro.config.cjs",
  ],
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
} as const satisfies Readonly<Record<GatedServer, readonly string[]>>;

interface RepoTool {
  readonly description?: string;
  readonly input?: object;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "target",
]);
const MAX_DOWN_DEPTH = 2;

const markerIn = (directory: string, markers: readonly string[]) =>
  markers.some((marker) => existsSync(join(directory, marker)));

const hasMarkerUpward = (startDirectory: string, markers: readonly string[]) => {
  let directory = startDirectory;
  for (;;) {
    if (markerIn(directory, markers)) return true;
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
};

const hasMarkerDownward = (
  directory: string,
  markers: readonly string[],
  depth: number,
): boolean => {
  if (depth <= 0) return false;
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      SKIP_DIRS.has(entry.name)
    )
      continue;
    const child = join(directory, entry.name);
    if (
      markerIn(child, markers) ||
      hasMarkerDownward(child, markers, depth - 1)
    )
      return true;
  }
  return false;
};

export const hasMarkerNearby = (
  directory: string,
  markers: readonly string[],
) =>
  hasMarkerUpward(directory, markers) ||
  hasMarkerDownward(directory, markers, MAX_DOWN_DEPTH);

export const serverForTool = (tool: string): GatedServer | undefined => {
  for (const server of GATED_SERVERS) {
    const prefix = server
      .split("-")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[-_]");
    if (tool === server || new RegExp(`^${prefix}(?:[._:/-]|__)`).test(tool)) {
      return server;
    }
  }
};

export const filterRepoTools = (
  tools: Record<string, RepoTool>,
  directory: string,
) => {
  const enabled = new Map<GatedServer, boolean>();
  for (const tool of Object.keys(tools)) {
    const server = serverForTool(tool);
    if (!server) continue;
    const available =
      enabled.get(server) ??
      hasMarkerNearby(directory, REPO_REQUIRED_MARKERS[server]);
    enabled.set(server, available);
    if (!available) delete tools[tool];
  }
};

export const removeGatedTools = (tools: Record<string, RepoTool>) => {
  for (const tool of Object.keys(tools)) {
    if (serverForTool(tool)) delete tools[tool];
  }
};

export default Plugin.define({
  id: "mcp-repo-gate",
  effect: (context) =>
    Effect.gen(function* () {
      yield* context.session.hook("context", (event) =>
        Effect.gen(function* () {
          const session = yield* context.session
            .get({ sessionID: event.sessionID })
            .pipe(Effect.result);
          if (Result.isFailure(session)) {
            removeGatedTools(event.tools);
            return;
          }
          filterRepoTools(event.tools, session.success.location.directory);
        }),
      );
    }),
});
