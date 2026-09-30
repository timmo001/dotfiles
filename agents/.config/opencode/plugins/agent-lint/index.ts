/**
 * @file Runs the repository's fallback lint commands after a successful agent run and leaves any problems waiting for the next message.
 */

import type { OpenCodeClient } from "@opencode/client/effect";
import { Plugin } from "@opencode/plugin/effect";
import type { Session } from "@opencode/schema/session";
import { Effect, Fiber, Schema, Stream } from "effect";
import { isAbsolute, join } from "node:path";
import { runText } from "../lib/process";
import { connectClient, discoverService } from "../lib/service";
import { AgentLintRpc, idleStatus, type LintCheck, type LintStatus, SOURCE } from "./rpc";

const Report = Schema.fromJsonString(
  Schema.Struct({
    configured: Schema.Boolean,
    results: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        status: Schema.String,
        output: Schema.optionalKey(Schema.String),
        command: Schema.optionalKey(Schema.Array(Schema.String)),
      }),
    ),
  }),
);

const shellQuote = (arg: string) =>
  /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;

export default Plugin.define({
  id: "agent-lint",
  effect: (context) =>
    Effect.gen(function* () {
      const running = new Map<Session.ID, Fiber.Fiber<void>>();
      const statuses = new Map<string, LintStatus>();
      // Only repositories seen with agent_lint config show a running state.
      const configuredRoots = new Map<string, boolean>();
      let client: OpenCodeClient | undefined;

      const registration = yield* context.rpc.register(AgentLintRpc, {
        status: (input) =>
          Effect.succeed(statuses.get(input.sessionID) ?? idleStatus(input.sessionID)),
      }).pipe(Effect.orDie);

      const publish = (status: LintStatus) =>
        Effect.gen(function* () {
          statuses.set(status.sessionID, status);
          yield* registration.events.emit("status", status);
        }).pipe(Effect.catch((error) => Effect.logWarning(`agent-lint: ${String(error)}`)));

      const getClient = Effect.gen(function* () {
        if (client) return client;

        const endpoint = yield* discoverService();

        if (!endpoint) return yield* Effect.fail(new Error("OpenCode service not found"));

        client = yield* connectClient(endpoint);

        return client;
      });

      const lint = (sessionID: Session.ID) =>
        Effect.gen(function* () {
          const session = yield* context.session.get({ sessionID });

          // Execution events carry no location, so every loaded copy of this plugin sees them.
          if (session.parentID || session.location.directory !== context.location.directory) return;

          const directory = session.location.directory;
          const api = yield* getClient;
          const diff = yield* api.session.diff({ sessionID, context: 0 });

          if (!diff.length) return;

          // Snapshot diffs name files relative to the worktree root.
          const root = (yield* runText("git", ["rev-parse", "--show-toplevel"], {
            cwd: directory,
          })).trim();

          const files = diff
            .filter((file) => file.status !== "deleted")
            .map((file) => (isAbsolute(file.file) ? file.file : join(root, file.file)));

          if (!files.length) return;

          const announced = configuredRoots.get(root) === true;

          if (announced) yield* publish({ ...idleStatus(sessionID), running: true });

          const report = yield* runText("dot", ["agent-lint", "--json", ...files], {
            cwd: directory,
            okExitCodes: [0, 1],
          }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Report)),
            Effect.onInterrupt(() => (announced ? publish(idleStatus(sessionID)) : Effect.void)),
          );

          configuredRoots.set(root, report.configured);

          if (!report.configured) {
            if (announced) yield* publish(idleStatus(sessionID));

            return;
          }

          const waiting = yield* api.session.inbox.list({ sessionID });

          yield* Effect.forEach(
            waiting.filter(
              (item) => item.type === "synthetic" && item.payload.metadata?.source === SOURCE,
            ),
            (item) => api.session.inbox.cancel({ sessionID, inboxID: item.id }),
            { discard: true },
          );

          const failed = report.results.filter((result) => result.status === "failed");

          const timedOut = report.results
            .filter((result) => result.status === "timed-out")
            .map((result) => result.name);

          yield* publish({
            sessionID,
            running: false,
            clean: !failed.length && !timedOut.length,
            timedOut,
          });

          const checks: Array<LintCheck> = failed.flatMap((result) =>
            result.output
              ? [{ command: (result.command ?? []).map(shellQuote).join(" "), output: result.output.trimEnd() }]
              : [],
          );

          if (!checks.length) return;

          yield* context.session.synthetic({
            sessionID,
            text: [
              ...checks.map((check) => `$ ${check.command}\n${check.output}`),
              "Please fix these, then run all relevant checks and keep going until they pass.",
            ].join("\n\n"),
            delivery: "steer",
            resume: false,
            metadata: { source: SOURCE, problems: checks.length, checks },
          });
        }).pipe(
          Effect.catch((error) => Effect.logWarning(`agent-lint: ${String(error)}`)),
        );

      const stop = (sessionID: Session.ID) =>
        Effect.gen(function* () {
          const fiber = running.get(sessionID);

          if (!fiber) return;

          running.delete(sessionID);
          yield* Fiber.interrupt(fiber);
        });

      yield* context.event.subscribe().pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            switch (event.type) {
              case "session.execution.started":
              case "session.execution.failed":
              case "session.execution.interrupted":
                return yield* stop(event.data.sessionID);
              case "session.execution.succeeded":
                yield* stop(event.data.sessionID);

                running.set(
                  event.data.sessionID,
                  yield* Effect.forkScoped(lint(event.data.sessionID)),
                );
            }
          }),
        ),
        Effect.orDie,
        Effect.forkScoped,
      );
    }),
});
