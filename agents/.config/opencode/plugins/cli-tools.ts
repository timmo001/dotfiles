/**
 * @file Exposes the dot, Context and Notes CLIs as typed Code Mode tools.
 */

import { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import { Effect, Result, Schema } from "effect";
import { contextTools } from "./lib/cli-tools/context";
import { loadDotTools } from "./lib/cli-tools/dot";
import { notesTools } from "./lib/cli-tools/notes";
import { CliInput, type CliTool, runCli } from "./lib/cli-tools/tool";

interface CliNamespace {
  readonly command: string;
  readonly description: string;
  readonly tools: readonly CliTool[];
}

const Json = Schema.fromJsonString(Schema.Unknown);

const tail = (text: string) => text.trim().split("\n").slice(-20).join("\n");

export default Plugin.define({
  id: "cli-tools",
  effect: (context) =>
    Effect.gen(function* () {
      const dotTools = yield* loadDotTools.pipe(Effect.result);

      if (Result.isFailure(dotTools))
        yield* Effect.logWarning(`cli-tools: no dot tools: ${dotTools.failure.message}`);

      const namespaces: readonly CliNamespace[] = [
        {
          command: "dot",
          description:
            "The dot dotfiles CLI: tracked repositories, pull request queues, sessions, services, Herdr, skills and machine health.",
          tools: Result.isSuccess(dotTools) ? dotTools.success : [],
        },
        {
          command: "context",
          description: "The Context CLI: git branch context and tech-stack detection for the session's directory.",
          tools: contextTools,
        },
        {
          command: "notes",
          description:
            "The Notes CLI: read, search and change the repository's Markdown notes and handoffs. Changes are committed and pushed.",
          tools: notesTools,
        },
      ];

      const execute = (namespace: CliNamespace, tool: CliTool) => {
        const id = `${namespace.command}_${tool.name}`;
        const permission = `${namespace.command}.write`;

        return (input: CliInput, call: Tool.Context) =>
          Effect.gen(function* () {
            const invocation = yield* tool.invocation(input);
            const commandLine = [namespace.command, ...invocation.args].join(" ");

            if (tool.access === "write")
              yield* context.permission.assert({
                sessionID: call.sessionID,
                agent: call.agent,
                action: permission,
                resources: [id],
                save: [id],
                metadata: { command: commandLine },
                source: { type: "tool", messageID: call.messageID, id: call.id },
              });

            const session = yield* context.session
              .get({ sessionID: call.sessionID })
              .pipe(
                Effect.mapError(
                  (error) => new Tool.Error({ message: "Could not read the session's directory", error }),
                ),
              );

            const run = yield* runCli(namespace.command, invocation.args, {
              cwd: session.location.directory,
              stdin: invocation.stdin,
              timeout: tool.timeout,
            });

            if (run.exitCode !== 0)
              return yield* new Tool.Error({
                message: `${commandLine} exited ${run.exitCode}\n${tail(run.stderr || run.stdout)}`,
                metadata: { exitCode: run.exitCode },
              });

            if (!tool.json) return { output: run.stdout.trimEnd() };

            const output = yield* Schema.decodeUnknownEffect(Json)(run.stdout).pipe(
              Effect.mapError(
                (error) =>
                  new Tool.Error({ message: `${commandLine} did not print JSON: ${error.message}` }),
              ),
            );

            return { output };
          });
      };

      yield* context.tool.transform((draft) => {
        for (const namespace of namespaces) {
          if (namespace.tools.length === 0 || Bun.which(namespace.command) === null) continue;

          draft.namespace({ name: namespace.command, description: namespace.description });

          for (const tool of namespace.tools) {
            const run = execute(namespace, tool);
            const base = { namespace: namespace.command, codemode: true, pinned: tool.pinned } as const;

            draft.add({
              name: tool.name,
              description: tool.description,
              input: tool.input,
              output: tool.json ? Schema.Unknown : Schema.String,
              options:
                tool.access === "write"
                  ? { ...base, permission: `${namespace.command}.write` }
                  : base,
              execute: (input, call) =>
                Schema.decodeUnknownEffect(CliInput)(input).pipe(
                  Effect.mapError(
                    (error) => new Tool.Error({ message: `Invalid input: ${error.message}` }),
                  ),
                  Effect.flatMap((decoded) => run(decoded, call)),
                ),
            });
          }
        }
      });
    }),
});
