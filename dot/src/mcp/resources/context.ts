/**
 * @file MCP context resources.
 *
 * Registers read-only resources on the MCP server: the current repository's
 * repo-note context block (`dot://notes/context`) and per-command help
 * (`dot://command/{name}`). Generic git and stack context resources live in
 * the standalone `context mcp` server.
 */
import { Effect, Schema } from "effect";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { renderHelp } from "../../cli/help.js";
import { nativeCommandNames } from "../../cli/spec.js";
import { Notes } from "../../notes/services/Notes.js";

/** Named template parameter for the per-command help resource. */
const commandParam = McpSchema.param("name", Schema.String);

/**
 * OpenCode command name used when rendering {@link Notes.context} for the
 * `dot://notes/context` resource. `notes-list` includes the current
 * repository's note list in the rendered block.
 */
const CONTEXT_COMMAND = "notes-list";

/**
 * Register dot-owned read-only resources on the current {@link McpServer}.
 */
export const registerContextResources = Effect.gen(function* () {
  yield* McpServer.registerResource({
    uri: "dot://notes/context",
    name: "repo note context",
    description:
      "The current repository's OpenCode repo-note context block: repository identity, notes path, and recent notes.",
    mimeType: "text/markdown",
    content: Effect.gen(function* () {
      const notes = yield* Notes;
      return yield* notes.context({ command: CONTEXT_COMMAND });
    }),
  });

  yield* McpServer.registerResource`dot://command/${commandParam}`({
    name: "dot command help",
    description:
      "Help text for a single dot command, e.g. dot://command/notes.",
    mimeType: "text/plain",
    completion: {
      name: (input) =>
        Effect.succeed(
          [...nativeCommandNames]
            .filter((name) => name.startsWith(input))
            .sort(),
        ),
    },
    content: (_uri, name) => Effect.sync(() => renderHelp(name)),
  });
});
