/**
 * @file Per-repo MCP server gating for OpenCode.
 */

import { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem, Result } from "effect";
import { dirname, join } from "node:path";

export const GATED_SERVERS = [
  "pitchfork",
  "convex",
  "astro-docs",
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
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    for (const marker of markers) {
      const present = yield* fs
        .exists(join(directory, marker))
        .pipe(Effect.orElseSucceed(() => false));

      if (present) return true;
    }

    return false;
  });

const hasMarkerUpward = (startDirectory: string, markers: readonly string[]) =>
  Effect.gen(function* () {
    let directory = startDirectory;

    for (;;) {
      if (yield* markerIn(directory, markers)) return true;
      const parent = dirname(directory);

      if (parent === directory) return false;
      directory = parent;
    }
  });

const isRealDirectory = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (yield* fs.readLink(path).pipe(Effect.as(true), Effect.orElseSucceed(() => false))) {
      return false;
    }

    const info = yield* fs.stat(path);

    return info.type === "Directory";
  }).pipe(Effect.orElseSucceed(() => false));

const hasMarkerDownward = (
  directory: string,
  markers: readonly string[],
  depth: number,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (depth <= 0) return false;
    const fs = yield* FileSystem.FileSystem;

    const entries = yield* fs
      .readDirectory(directory)
      .pipe(Effect.orElseSucceed((): string[] => []));

    for (const name of entries) {
      if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
      const child = join(directory, name);

      if (!(yield* isRealDirectory(child))) continue;

      if (
        (yield* markerIn(child, markers)) ||
        (yield* hasMarkerDownward(child, markers, depth - 1))
      )
        return true;
    }

    return false;
  });

export const hasMarkerNearby = (
  directory: string,
  markers: readonly string[],
) =>
  Effect.gen(function* () {
    return (
      (yield* hasMarkerUpward(directory, markers)) ||
      (yield* hasMarkerDownward(directory, markers, MAX_DOWN_DEPTH))
    );
  });

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
) =>
  Effect.gen(function* () {
    const enabled = new Map<GatedServer, boolean>();

    for (const tool of Object.keys(tools)) {
      const server = serverForTool(tool);

      if (!server) continue;

      const available =
        enabled.get(server) ??
        (yield* hasMarkerNearby(directory, REPO_REQUIRED_MARKERS[server]));

      enabled.set(server, available);

      if (!available) delete tools[tool];
    }
  });

export const removeGatedTools = (tools: Record<string, RepoTool>) => {
  for (const tool of Object.keys(tools)) {
    if (serverForTool(tool)) delete tools[tool];
  }
};

const blockedToolError = (tool: string, directory?: string) =>
  new Tool.Error({
    message: directory
      ? `${tool} is unavailable because ${directory} does not contain the required repository marker.`
      : `${tool} is unavailable because the current repository could not be resolved.`,
  });

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

          yield* filterRepoTools(event.tools, session.success.location.directory);
        }).pipe(Effect.provide(NodeFileSystem.layer)),
      );

      yield* context.tool.hook("execute.before", (event) =>
        Effect.gen(function* () {
          const server = serverForTool(event.tool);

          if (!server) return;

          const session = yield* context.session
            .get({ sessionID: event.sessionID })
            .pipe(Effect.result);

          if (Result.isFailure(session)) {
            return yield* Effect.fail(blockedToolError(event.tool));
          }

          const directory = session.success.location.directory;

          if (!(yield* hasMarkerNearby(directory, REPO_REQUIRED_MARKERS[server]))) {
            return yield* Effect.fail(blockedToolError(event.tool, directory));
          }
        }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
    }),
});
