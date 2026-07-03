/**
 * @file MCP server composition for `dot mcp`.
 *
 * Builds the stdio MCP server layer: registers the notes toolkit, wires the
 * real {@link Notifier}, and provides the stdio transport via
 * `@effect/platform-node` `NodeStdio`. Logging is forced to stderr so stdout
 * carries only the JSON-RPC protocol stream.
 */
import { Layer, Logger } from "effect";
import { NodeStdio } from "@effect/platform-node";
import { McpServer } from "effect/unstable/ai";
import { Notifier } from "./services/Notifier.js";
import { registerNotesTools } from "./tools/notes.js";

/** MCP server name reported to clients. */
const SERVER_NAME = "dot";
/** MCP server version reported to clients. */
const SERVER_VERSION = "0.1.0";

/**
 * Fully composed MCP server layer. Remaining requirements (`Notes`,
 * `CommandExecutor`) are provided by the CLI layer stack when launched.
 */
export const McpServerLayer = Layer.effectDiscard(registerNotesTools).pipe(
  Layer.provide(Notifier.layerNotifySend),
  Layer.provide(
    McpServer.layerStdio({ name: SERVER_NAME, version: SERVER_VERSION }),
  ),
  Layer.provide(NodeStdio.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
);
