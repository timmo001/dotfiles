/**
 * @file MCP context resources.
 *
 * Registers read-only resources on the MCP server. Generic git and stack
 * context resources live in the standalone `context mcp` server, and repo notes
 * resources live in the standalone `notes mcp` server.
 */
import { Effect, Schema } from "effect";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { renderHelp } from "../../cli/help.js";
import { nativeCommandNames } from "../../cli/spec.js";

/** Named template parameter for the per-command help resource. */
const commandParam = McpSchema.param("name", Schema.String);

/** Register dot-owned read-only resources on the current {@link McpServer}. */
export const registerContextResources =
  McpServer.registerResource`dot://command/${commandParam}`({
    name: "dot command help",
    description:
      "Help text for a single dot command, e.g. dot://command/dashboard.",
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
