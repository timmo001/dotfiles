/**
 * @file Shared MCP tool registration helper.
 *
 * Registers a tool directly on the current {@link McpServer} so its result is
 * returned as raw text rather than JSON-escaped: the handler yields a plain
 * string, wrapped in a successful {@link McpSchema.CallToolResult}, and any
 * failure cause is rendered with {@link Cause.pretty} into an error result.
 * Both the notes tools and the context tools use this so their output stays raw
 * markdown, text, or JSON.
 */
import { Cause, Context, Effect, Schema } from "effect";
import { McpSchema, McpServer, Tool } from "effect/unstable/ai";

/** MCP tool annotations for a read-only, closed-world, idempotent tool. */
export const READONLY_HINTS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** MCP tool annotations for a destructive, closed-world tool. */
export const DESTRUCTIVE_HINTS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Behavioural hint sets accepted by a {@link ToolRegistrar}. */
export type ToolHints = typeof READONLY_HINTS | typeof DESTRUCTIVE_HINTS;

/** Options describing a single raw-text MCP tool registration. */
export interface ToolRegistration<
  S extends Schema.Codec<unknown, unknown, never, never>,
  E,
> {
  /** Tool name as exposed to MCP clients. */
  readonly name: string;
  /** Human-readable tool description. */
  readonly description: string;
  /** Effect schema for the tool's input parameters. */
  readonly parameters: S;
  /** Behavioural hints (read-only or destructive). */
  readonly annotations: ToolHints;
  /** Handler returning raw text; failures render via {@link Cause.pretty}. */
  readonly handle: (params: S["Type"]) => Effect.Effect<string, E>;
}

/** Registers a raw-text tool on the current {@link McpServer}. */
export interface ToolRegistrar {
  <S extends Schema.Codec<unknown, unknown, never, never>, E>(
    options: ToolRegistration<S, E>,
  ): Effect.Effect<void>;
}

/**
 * Acquire a {@link ToolRegistrar} bound to the current {@link McpServer}. Each
 * registered tool decodes its payload with the given schema, runs the handler,
 * and returns the handler's string as a raw-text {@link McpSchema.CallToolResult};
 * any failure cause (schema decode or handler) is rendered to text with
 * {@link Cause.pretty}.
 */
export const makeToolRegistrar: Effect.Effect<
  ToolRegistrar,
  never,
  McpServer.McpServer
> = Effect.gen(function* () {
  const server = yield* McpServer.McpServer;

  const register: ToolRegistrar = (options) => {
    const decode = Schema.decodeEffect(options.parameters);
    return server.addTool({
      tool: new McpSchema.Tool({
        name: options.name,
        description: options.description,
        inputSchema: Tool.getJsonSchemaFromSchema(options.parameters),
        annotations: options.annotations,
      }),
      annotations: Context.empty(),
      handle: (payload) =>
        decode(payload).pipe(
          Effect.flatMap(options.handle),
          Effect.matchCause({
            onFailure: (cause) =>
              new McpSchema.CallToolResult({
                isError: true,
                content: [{ type: "text", text: Cause.pretty(cause) }],
              }),
            onSuccess: (text) =>
              new McpSchema.CallToolResult({
                isError: false,
                content: [{ type: "text", text }],
              }),
          }),
        ),
    });
  };

  return register;
});
