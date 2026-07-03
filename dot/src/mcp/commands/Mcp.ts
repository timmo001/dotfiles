/**
 * @file `dot mcp` native command handler.
 *
 * Launches the stdio MCP server and runs until the client disconnects or the
 * process is interrupted. Runs under the native CLI layer stack, which supplies
 * the `Notes` and `CommandExecutor` services the server needs.
 */
import { Layer } from "effect";
import { McpServerLayer } from "../server.js";

/** Run the `dot mcp` stdio server. Resolves only on interruption. */
export const mcpCommand = (_args: readonly string[]) =>
  Layer.launch(McpServerLayer);
