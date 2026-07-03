/**
 * @file `dot mcp` native command handler.
 *
 * Runs the stdio MCP server as the process main fiber via `NodeRuntime.runMain`,
 * which installs `SIGINT`/`SIGTERM` handling and keeps the process alive until
 * the client disconnects. The server runs under the native CLI layer stack,
 * which supplies the `Notes` and `CommandExecutor` services it needs.
 */
import { Cause, Exit, Layer, Runtime } from "effect";
import { McpServerLayer } from "../server.js";

/**
 * Exit-code policy for the stdio server. A client disconnect is delivered as
 * fiber interruption (stdin EOF, `SIGINT`, or `SIGTERM`); treat that and normal
 * completion as a clean exit (code 0), and defer genuine failures to the
 * default error exit code so real crashes still surface.
 */
export const mcpTeardown: Runtime.Teardown = (exit, onExit) =>
  Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
    ? Runtime.defaultTeardown(exit, onExit)
    : onExit(0);

/**
 * The stdio MCP server effect. Suspends until the client disconnects, then the
 * transport interrupts this fiber. Requires `Notes` and `CommandExecutor`,
 * provided by the CLI layer stack at the call site.
 */
export const mcpServer = Layer.launch(McpServerLayer);
