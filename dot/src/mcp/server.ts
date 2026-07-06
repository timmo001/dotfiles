/**
 * @file MCP server composition for `dot mcp`.
 *
 * Builds the stdio MCP server layer for dot-owned resources. Logging is forced
 * to stderr so stdout carries only the JSON-RPC protocol stream.
 */
import { Layer, Logger } from "effect";
import { NodeStdio } from "@effect/platform-node";
import { McpServer } from "effect/unstable/ai";
import { registerContextResources } from "./resources/context.js";

/** MCP server name reported to clients. */
const SERVER_NAME = "dot";
/** MCP server version reported to clients. */
const SERVER_VERSION = "0.1.0";

/**
 * Fully composed MCP server layer.
 */
export const McpServerLayer = Layer.effectDiscard(
  registerContextResources,
).pipe(
  Layer.provide(
    McpServer.layerStdio({ name: SERVER_NAME, version: SERVER_VERSION }),
  ),
  Layer.provide(NodeStdio.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
);
