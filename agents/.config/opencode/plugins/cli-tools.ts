/**
 * @file Exposes everyday CLIs and Effect clients as typed Code Mode tools.
 */

import { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import { Effect, Result, Schema } from "effect";
import { contextTools } from "./lib/cli-tools/context";
import { ghNamespace } from "./lib/cli-tools/gh";
import { haBridgeNamespace } from "./lib/cli-tools/ha-bridge";
import { herdrNamespace } from "./lib/cli-tools/herdr";
import { hyprctlNamespace } from "./lib/cli-tools/hyprctl";
import { loadDotTools } from "./lib/cli-tools/dot";
import { miseNamespace } from "./lib/cli-tools/mise";
import { notesTools } from "./lib/cli-tools/notes";
import { omarchyNamespace } from "./lib/cli-tools/omarchy";
import { pitchforkNamespace } from "./lib/cli-tools/pitchfork";
import { systemBridgeNamespace } from "./lib/cli-tools/system-bridge";
import { systemdNamespace } from "./lib/cli-tools/systemd";
import {
  CliInput,
  type CliNamespace,
  type CliTool,
  type CliToolAccess,
  type ClientNamespace,
  type ClientTool,
  type Namespace,
  runCliOutput,
} from "./lib/cli-tools/tool";
import { triageNamespace } from "./lib/cli-tools/triage";
import { upnextNamespace } from "./lib/cli-tools/upnext";

export default Plugin.define({
  id: "cli-tools",
  effect: (context) =>
    Effect.gen(function* () {
      const dotTools = yield* loadDotTools.pipe(Effect.result);

      if (Result.isFailure(dotTools))
        yield* Effect.logWarning(`cli-tools: no dot tools: ${dotTools.failure.message}`);

      const namespaces: readonly Namespace[] = [
        {
          kind: "cli",
          command: "dot",
          description:
            "The dot dotfiles CLI: tracked repositories, pull request queues, sessions, services, Herdr, skills and machine health.",
          tools: Result.isSuccess(dotTools) ? dotTools.success : [],
        },
        {
          kind: "cli",
          command: "context",
          description: "The Context CLI: git branch context and tech-stack detection for the session's directory.",
          tools: contextTools,
        },
        {
          kind: "cli",
          command: "notes",
          description:
            "The Notes CLI: read, search and change the repository's Markdown notes and handoffs. Changes are committed and pushed.",
          tools: notesTools,
        },
        triageNamespace,
        ghNamespace,
        herdrNamespace,
        haBridgeNamespace,
        systemBridgeNamespace,
        upnextNamespace,
        systemdNamespace,
        hyprctlNamespace,
        pitchforkNamespace,
        miseNamespace,
        omarchyNamespace,
      ];

      // OpenCode's prompt only shows the action for plugin permissions, so the action names the
      // tool and what it acts on; rules match it with `<namespace>.write *`.
      const assertWrite = (
        namespace: Namespace,
        access: CliToolAccess,
        call: Tool.Context,
        target: string,
        resource: string,
        command: string,
      ) => {
        if (access !== "write") return Effect.void;

        return context.permission.assert({
          sessionID: call.sessionID,
          agent: call.agent,
          action: `${namespace.command}.write ${target}`,
          resources: [resource],
          save: [resource],
          metadata: { command },
          source: { type: "tool", messageID: call.messageID, id: call.id },
        });
      };

      const sessionDirectory = (call: Tool.Context) =>
        context.session.get({ sessionID: call.sessionID }).pipe(
          Effect.map((session) => session.location.directory),
          Effect.mapError(
            (error) => new Tool.Error({ message: "Could not read the session's directory", error }),
          ),
        );

      const executeClient = (namespace: ClientNamespace, tool: ClientTool) => {
        return (input: CliInput, call: Tool.Context) =>
          Effect.gen(function* () {
            const directory = yield* sessionDirectory(call);
            const prepared = yield* tool.prepare(input, { directory });
            const target = prepared.resource === undefined ? tool.name : `${tool.name} ${prepared.resource}`;

            yield* assertWrite(
              namespace,
              prepared.access ?? tool.access,
              call,
              target,
              `${namespace.command}_${target}`,
              prepared.summary,
            );

            return { output: yield* prepared.run };
          });
      };

      const execute = (namespace: CliNamespace, tool: CliTool) => {
        const id = `${namespace.command}_${tool.name}`;

        return (input: CliInput, call: Tool.Context) =>
          Effect.gen(function* () {
            const invocation = yield* tool.invocation(input);
            const commandLine = [namespace.command, ...invocation.args].join(" ");

            yield* assertWrite(namespace, tool.access, call, tool.name, id, commandLine);

            const output = yield* runCliOutput(namespace.command, invocation.args, {
              cwd: yield* sessionDirectory(call),
              stdin: invocation.stdin,
              timeout: tool.timeout,
              json: tool.json,
              exitCodes: tool.exitCodes,
            });

            return { output };
          });
      };

      const enabled = yield* Effect.forEach(
        namespaces,
        (namespace) =>
          namespace.kind === "cli"
            ? Effect.succeed(namespace.tools.length > 0 && Bun.which(namespace.command) !== null)
            : namespace.available,
        { concurrency: "unbounded" },
      );

      const clientToolsEnabled = yield* Effect.forEach(
        namespaces,
        (namespace, index) =>
          namespace.kind === "client" && enabled[index]
            ? Effect.filter(namespace.tools, (tool) => tool.available ?? Effect.succeed(true), {
                concurrency: "unbounded",
              })
            : Effect.succeed([]),
        { concurrency: "unbounded" },
      );

      const toolOptions = (namespace: Namespace, tool: CliTool | ClientTool) => {
        const base = { namespace: namespace.command, codemode: true, pinned: tool.pinned } as const;

        return tool.access === "write" ? { ...base, permission: `${namespace.command}.write` } : base;
      };

      const decodeInput = Schema.decodeUnknownEffect(CliInput);

      const invalidInput = (error: Schema.SchemaError) =>
        new Tool.Error({ message: `Invalid input: ${error.message}` });

      yield* context.tool.transform((draft) => {
        namespaces.forEach((namespace, index) => {
          if (!enabled[index]) return;

          draft.namespace({ name: namespace.command, description: namespace.description });

          if (namespace.kind === "client") {
            for (const tool of clientToolsEnabled[index] ?? []) {
              const run = executeClient(namespace, tool);
              draft.add({
                name: tool.name,
                description: tool.description,
                input: tool.input,
                output: Schema.Unknown,
                options: toolOptions(namespace, tool),
                execute: (input, call) =>
                decodeInput(input).pipe(
                  Effect.mapError(invalidInput),
                  Effect.flatMap((decoded) => run(decoded, call)),
                ),
              });
            }

            return;
          }

          for (const tool of namespace.tools) {
            const run = execute(namespace, tool);
            draft.add({
              name: tool.name,
              description: tool.description,
              input: tool.input,
              output: tool.json ? Schema.Unknown : Schema.String,
              options: toolOptions(namespace, tool),
              execute: (input, call) =>
                decodeInput(input).pipe(
                  Effect.mapError(invalidInput),
                  Effect.flatMap((decoded) => run(decoded, call)),
                ),
            });
          }
        });
      });
    }),
});
