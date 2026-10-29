/**
 * @file Exposes everyday CLIs and Effect clients as typed Code Mode tools.
 */

import { resolve } from "node:path";
import { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import { Effect, Result, Schema } from "effect";
import { argRecord, stringArg } from "../lib/guard-paths";
import { contextNamespace } from "./lib/cli-tools/context";
import { ghJobs, ghNamespace } from "./lib/cli-tools/gh";
import { gitNamespace } from "./lib/cli-tools/git";
import { haBridgeNamespace } from "./lib/cli-tools/ha-bridge";
import { herdrNamespace } from "./lib/cli-tools/herdr";
import { hyprctlNamespace } from "./lib/cli-tools/hyprctl";
import { loadDotTools } from "./lib/cli-tools/dot";
import { jobsNamespace } from "./lib/cli-tools/jobs";
import { miseNamespace } from "./lib/cli-tools/mise";
import { notesNamespace } from "./lib/cli-tools/notes";
import { omarchyNamespace } from "./lib/cli-tools/omarchy";
import { opencode2Namespace } from "./lib/cli-tools/opencode2";
import {
  aubeNamespace,
  bunNamespace,
  npmNamespace,
  pnpmNamespace,
  yarnNamespace,
} from "./lib/cli-tools/package-managers";
import { pacmanNamespace } from "./lib/cli-tools/pacman";
import { pitchforkNamespace } from "./lib/cli-tools/pitchfork";
import { type CodeModeCatalogue, runsDotUpdate, shellNudge } from "./lib/cli-tools/shell-nudge";
import { skillMaintenanceNamespace } from "./lib/cli-tools/skill-maintenance";
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

      const ownNamespaces: readonly Namespace[] = [
        {
          kind: "cli",
          command: "dot",
          description:
            "The dot dotfiles CLI: tracked repositories, pull request queues, sessions, services, Herdr, skills and machine health. To run `dot update`, start `dot.update` with jobs.start.",
          tools: Result.isSuccess(dotTools) ? dotTools.success.tools : [],
        },
        notesNamespace,
        contextNamespace,
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
        pnpmNamespace,
        bunNamespace,
        npmNamespace,
        aubeNamespace,
        yarnNamespace,
        omarchyNamespace,
        gitNamespace,
        opencode2Namespace,
        pacmanNamespace,
        skillMaintenanceNamespace,
      ];

      const namespaces: readonly Namespace[] = [
        ...ownNamespaces,
        jobsNamespace([
          ...ownNamespaces.flatMap((namespace): CliNamespace[] => {
            if (namespace.kind !== "cli") return [];

            return namespace.command === "dot" && Result.isSuccess(dotTools)
              ? [{ ...namespace, tools: dotTools.success.jobs }]
              : [namespace];
          }),
          ghJobs,
        ]),
      ];

      // OpenCode's prompt only shows the action for plugin permissions, so the action names the
      // tool and what it acts on; rules match it with `<namespace>.write *`.
      const assertWrite = (
        namespace: string,
        access: CliToolAccess,
        call: Tool.Context,
        target: string,
        resource: string,
        command: string,
        alwaysAsk = false,
      ) => {
        if (access !== "write") return Effect.void;

        return context.permission.assert({
          sessionID: call.sessionID,
          agent: call.agent,
          action: `${namespace}.write ${target}`,
          resources: [resource],
          // An empty save list keeps "always" from being stored, so the next call asks again.
          save: alwaysAsk ? [] : [resource],
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
            const owner = prepared.permission?.namespace ?? namespace.command;
            const name = prepared.permission?.tool ?? tool.name;
            const target = prepared.resource === undefined ? name : `${name} ${prepared.resource}`;

            yield* assertWrite(
              owner,
              prepared.access ?? tool.access,
              call,
              target,
              `${owner}_${target}`,
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

            yield* assertWrite(
              namespace.command,
              tool.access,
              call,
              tool.name,
              id,
              invocation.cwd === undefined ? commandLine : `${commandLine} (in ${invocation.cwd})`,
              tool.alwaysAsk,
            );

            const output = yield* runCliOutput(namespace.command, invocation.args, {
              cwd: invocation.cwd ?? (yield* sessionDirectory(call)),
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

      // `jobs` is a shell builtin, not the jobs namespace.
      const catalogue: CodeModeCatalogue = namespaces.reduce((map, namespace, index) => {
        if (!enabled[index] || namespace.command === "jobs") return map;

        const tools = namespace.kind === "client" ? (clientToolsEnabled[index] ?? []) : namespace.tools;

        return map.set(
          namespace.command,
          new Map([
            ...(map.get(namespace.command) ?? []),
            ...tools.map((tool): [string, boolean] => [tool.name, tool.directory ?? false]),
          ]),
        );
      }, new Map<string, ReadonlyMap<string, boolean>>());

      // Background shells are how long runs stay out of the foreground, so they keep the shell.
      yield* context.tool.hook("execute.after", (event) =>
        Effect.gen(function* () {
          if (event.tool !== "shell" && event.tool !== "bash") return;

          if (event.status !== "completed") return;

          const args = argRecord(event.input);

          if (args.background === true) return;

          const workdir = stringArg(args.workdir);

          // A workdir other than the session's needs the tool's directory input to run there.
          const directory =
            workdir === ""
              ? undefined
              : yield* context.session.get({ sessionID: event.sessionID }).pipe(
                  Effect.map(({ location }) => {
                    const resolved = resolve(location.directory, workdir);

                    return resolved === resolve(location.directory) ? undefined : resolved;
                  }),
                  Effect.orElseSucceed(() => undefined),
                );

          const nudge = shellNudge(stringArg(args.command), catalogue, directory);

          if (nudge === undefined) return;

          const existing = event.result.content;

          event.result = {
            ...event.result,
            content: Array.isArray(existing)
              ? [...existing, { type: "text" as const, text: nudge }]
              : Schema.is(Schema.String)(existing)
                ? `${existing}\n\n${nudge}`
                : nudge,
          };
        }),
      );

      const dotUpdateJob = Result.isSuccess(dotTools) && dotTools.success.jobs.some((tool) => tool.name === "update");

      // `dot update` reloads the OpenCode service, which cancels the shell running it, even in the background.
      yield* context.tool.hook("execute.before", (event) => {
        if (event.tool !== "shell" && event.tool !== "bash") return Effect.void;

        if (!dotUpdateJob || !runsDotUpdate(stringArg(argRecord(event.input).command))) return Effect.void;

        return Effect.fail(
          new Tool.Error({
            message:
              "cli-tools: dot update reloads the OpenCode service, which cancels the shell running it. " +
              'Start it through execute with `await tools.jobs.start({ tool: "dot.update" })`, ' +
              "then run the `follow` command it returns in a background shell.",
          }),
        );
      });
    }),
});
