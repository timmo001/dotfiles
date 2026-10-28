import { Tool } from "@opencode/schema/tool";
import { Effect, Layer, Schema } from "effect";
import { type ClientNamespace, clientTools, commandExists, runCliOutput } from "./tool";

const tool = clientTools(Layer.empty);

const ids = Schema.NonEmptyArray(Schema.String).annotate({
  description: "Daemon IDs, such as dev or ha-core/dev; short ones resolve from the session's directory",
});

const Daemons = Schema.Array(Schema.Struct({ id: Schema.String, status: Schema.String }));

const failed = new Set(["errored", "failed"]);

/**
 * Fail once a daemon that was starting has crashed. `pitchfork start` keeps waiting while a daemon
 * with `retry` set crashes over and over, so this ends the wait with its last log lines.
 */
const watchForCrash = (wanted: readonly string[], cwd: string) =>
  Effect.gen(function* () {
    const matches = (id: string) => wanted.some((name) => id === name || id.endsWith(`/${name}`));
    const started = new Set<string>();

    while (true) {
      yield* Effect.sleep("1 second");

      const daemons = yield* runCliOutput("pitchfork", ["list", "--json"], { cwd, json: true }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Daemons)),
        Effect.orElseSucceed(() => []),
      );

      for (const daemon of daemons.filter((entry) => matches(entry.id))) {
        if (!failed.has(daemon.status)) started.add(daemon.id);
        else if (started.has(daemon.id)) {
          const logs = yield* runCliOutput("pitchfork", ["logs", "--no-pager", "-n", "20", daemon.id], { cwd }).pipe(
            Effect.orElseSucceed(() => ""),
          );

          return yield* Effect.fail(
            new Tool.Error({ message: `${daemon.id} crashed while starting (${daemon.status}). Its last log lines:\n${String(logs)}` }),
          );
        }
      }
    }
  });

const control = (verb: "start" | "stop" | "restart", description: string) =>
  tool({
    name: verb,
    description,
    access: "write",
    timeout: "5 minutes",
    input: Schema.Struct({ ids }),
    resource: (input) => input.ids.join(" "),
    summary: (input) => `pitchfork ${verb} ${input.ids.join(" ")}`,
    run: (input, context) => {
      const run = runCliOutput("pitchfork", [verb, ...(verb === "stop" ? [] : ["--quiet"]), ...input.ids], {
        cwd: context.directory,
        timeout: "5 minutes",
      });

      return verb === "stop" ? run : Effect.raceFirst(run, watchForCrash(input.ids, context.directory));
    },
  });

/** Dev servers and other daemons run by pitchfork. */
export const pitchforkNamespace: ClientNamespace = {
  kind: "client",
  command: "pitchfork",
  description:
    "Dev servers and other daemons run by pitchfork: list them with their status and URLs, read their logs, and start, stop or restart them. Short daemon IDs resolve from the session's directory.",
  available: commandExists("pitchfork"),
  tools: [
    tool({
      name: "list",
      description: "List daemons with their status, PID, ports and proxy URLs.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        project: Schema.optionalKey(Schema.Boolean).annotate({
          description: "Only the daemons of the session's project",
        }),
        status: Schema.optionalKey(
          Schema.Array(
            Schema.Literals([
              "running",
              "stopped",
              "waiting",
              "stopping",
              "restarting",
              "failed",
              "errored",
              "completed",
              "available",
              "disabled",
            ]),
          ),
        ),
      }),
      run: (input, context) =>
        runCliOutput(
          "pitchfork",
          [
            "list",
            "--json",
            ...(input.project ? ["--project"] : []),
            ...(input.status ?? []).flatMap((status) => ["--status", status]),
          ],
          { cwd: context.directory, json: true },
        ),
    }),
    tool({
      name: "logs",
      description: "Read daemon logs, all of them or some daemons', newest last.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        ids: Schema.optionalKey(ids),
        lines: Schema.optionalKey(Schema.Int).annotate({ description: "The newest lines to show, 200 by default" }),
        since: Schema.optionalKey(Schema.String).annotate({ description: "Such as 5min, 2h, 10:30 or 2026-10-28 10:00" }),
        until: Schema.optionalKey(Schema.String),
        grep: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
          description: "Case-insensitive substrings, any of which a line must contain",
        }),
        level: Schema.optionalKey(Schema.Literals(["error", "warn", "info", "debug", "trace"])),
      }),
      run: (input, context) =>
        runCliOutput(
          "pitchfork",
          [
            "logs",
            "--no-pager",
            "-n",
            String(input.lines ?? 200),
            ...(input.since === undefined ? [] : ["--since", input.since]),
            ...(input.until === undefined ? [] : ["--until", input.until]),
            ...(input.grep ?? []).flatMap((pattern) => ["--grep", pattern]),
            ...(input.level === undefined ? [] : ["--level", input.level]),
            ...(input.ids ?? []),
          ],
          { cwd: context.directory },
        ),
    }),
    control("start", "Start daemons from their pitchfork.toml and wait until they're ready."),
    control("stop", "Stop daemons."),
    control("restart", "Restart daemons and wait until they're ready."),
  ],
};
