import { dirname } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { type ClientNamespace, clientTools, commandExists, runCliOutput, runCliText } from "./tool";

const tool = clientTools(Layer.empty);

const COMMAND = "opencode2";

const directory = Schema.optionalKey(
  Schema.String.check(Schema.isStartingWith("/")).annotate({
    description: "An absolute project directory instead of the session's",
  }),
);

/** OpenCode 2 itself through its CLI wrapper: debug info, sessions and the background service. */
export const opencode2Namespace: ClientNamespace = {
  kind: "client",
  command: "opencode2",
  description:
    "OpenCode 2 through the opencode2 CLI: resolved config sources, agents and paths, the project's sessions and exports, and the background service's status and a delayed restart.",
  available: commandExists(COMMAND),
  tools: [
    tool({
      name: "debug_config",
      description: "Read every configuration source OpenCode loaded here, in order, with its path and contents.",
      access: "read",
      input: Schema.Struct({ directory }),
      run: (input, context) =>
        runCliOutput(COMMAND, ["debug", "config"], { cwd: input.directory ?? context.directory, json: true }),
    }),
    tool({
      name: "debug_agents",
      description: "List the agents OpenCode resolved here, with their modes, models and permissions.",
      access: "read",
      input: Schema.Struct({ directory }),
      run: (input, context) => runCliText(COMMAND, ["debug", "agents"], { cwd: input.directory ?? context.directory }),
    }),
    tool({
      name: "debug_paths",
      description: "Show OpenCode's data, config, cache, state, log and database paths.",
      access: "read",
      input: Schema.Struct({}),
      run: () =>
        Effect.map(runCliText(COMMAND, ["debug", "paths"]), (text) =>
          Object.fromEntries(
            text
              .split("\n")
              .map((line) => line.trim().split(/\s+/))
              .filter((parts) => parts.length >= 2)
              .map(([name, ...rest]) => [name, rest.join(" ")]),
          ),
        ),
    }),
    tool({
      name: "session_list",
      description: "List the project's top-level sessions, newest first, with their titles and times in epoch milliseconds.",
      access: "read",
      input: Schema.Struct({
        directory,
        limit: Schema.optionalKey(Schema.Int).annotate({ description: "How many, 20 by default" }),
      }),
      run: (input, context) =>
        runCliOutput(COMMAND, ["session", "list", "--format", "json", "--max-count", String(input.limit ?? 20)], {
          cwd: input.directory ?? context.directory,
          json: true,
        }),
    }),
    tool({
      name: "session_export",
      description:
        "Export a session's data as JSON to a file and return its path, since transcripts are large. Read it with jq or targeted reads.",
      access: "read",
      input: Schema.Struct({
        sessionID: Schema.String.check(Schema.isStartingWith("ses")),
        path: Schema.optionalKey(Schema.String.check(Schema.isStartingWith("/"))).annotate({
          description: "Where to write it (default: /tmp/opencode/session-exports/<id>.json)",
        }),
        sanitize: Schema.optionalKey(Schema.Boolean).annotate({ description: "Redact sensitive transcript and file data" }),
      }),
      run: (input) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          const json = yield* runCliText(
            COMMAND,
            ["session", "export", input.sessionID, ...(input.sanitize ? ["--sanitize"] : [])],
            { timeout: "5 minutes" },
          );

          const path = input.path ?? `/tmp/opencode/session-exports/${input.sessionID}.json`;

          yield* fs.makeDirectory(dirname(path), { recursive: true });
          yield* fs.writeFileString(path, json);

          return { path, bytes: Buffer.byteLength(json) };
        }).pipe(Effect.provide(NodeServices.layer)),
    }),
    tool({
      name: "service_status",
      description: "Show the background server's address, or that it isn't running.",
      access: "read",
      input: Schema.Struct({}),
      run: () => runCliText(COMMAND, ["service", "status"]),
    }),
    tool({
      name: "service_restart",
      description:
        "Restart the background server after a delay, from a transient systemd unit so the restart outlives this call. Every session's running tools and shells stop; plugin code changes load.",
      access: "write",
      input: Schema.Struct({
        delaySeconds: Schema.optionalKey(Schema.Int).annotate({ description: "Seconds to wait, 15 by default" }),
      }),
      summary: (input) => `opencode2 service restart in ${input.delaySeconds ?? 15}s`,
      run: (input) =>
        Effect.gen(function* () {
          const unit = `opencode2-restart-${Date.now()}`;
          const delay = input.delaySeconds ?? 15;

          yield* runCliText("systemd-run", [
            "--user",
            `--on-active=${delay}`,
            `--unit=${unit}`,
            "-p",
            "KillMode=process",
            Bun.which(COMMAND) ?? COMMAND,
            "service",
            "restart",
          ]);

          return { unit, restartsInSeconds: delay };
        }),
    }),
  ],
};
