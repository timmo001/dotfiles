import { Layer, Schema } from "effect";
import { type ClientNamespace, clientTools, commandExists, runCliOutput } from "./tool";

const tool = clientTools(Layer.empty);

const ids = Schema.NonEmptyArray(Schema.String).annotate({
  description: "Daemon IDs, such as dev or ha-core/dev; short ones resolve from the session's directory",
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
    run: (input, context) =>
      runCliOutput("pitchfork", [verb, ...(verb === "stop" ? [] : ["--quiet"]), ...input.ids], {
        cwd: context.directory,
        timeout: "5 minutes",
      }),
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
