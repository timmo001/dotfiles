import { Tool } from "@opencode/schema/tool";
import { Effect, Layer, Schema } from "effect";
import {
  type ClientNamespace,
  clientTools,
  commandExists,
  runCli,
  runCliOutput,
  runCliText,
  tailLines,
  toToolError,
} from "./tool";

const tool = clientTools(Layer.empty);

const unit = Schema.String.annotate({ description: "A user unit, such as dot-deps.service or dot-deps.timer" });

const systemctl = (args: readonly string[]) => runCliText("systemctl", ["--user", "--no-pager", ...args]);

const systemctlJson = (args: readonly string[]) =>
  runCliOutput("systemctl", ["--user", "--no-pager", ...args], { json: true });

const statusProperties = [
  "Id",
  "Description",
  "LoadState",
  "ActiveState",
  "SubState",
  "Result",
  "UnitFileState",
  "MainPID",
  "ExecMainStatus",
  "NRestarts",
  "ActiveEnterTimestamp",
  "InactiveEnterTimestamp",
  "StateChangeTimestamp",
  "FragmentPath",
  "TriggeredBy",
  "Triggers",
];

/** `systemctl show` output as an object. */
const properties = (output: string) =>
  Object.fromEntries(
    output
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");

        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );

/** A systemd timestamp in microseconds since the epoch as an ISO string. */
const microseconds = (value: number | null) => (value !== null && value > 0 ? new Date(value / 1000).toISOString() : null);

const Timers = Schema.Array(
  Schema.Struct({
    unit: Schema.String,
    activates: Schema.String,
    next: Schema.NullOr(Schema.Number),
    last: Schema.NullOr(Schema.Number),
  }),
);

const control = (verb: "start" | "stop" | "restart") =>
  tool({
    name: `unit_${verb}`,
    description: `${verb.charAt(0).toUpperCase()}${verb.slice(1)} a user unit and wait for the job to finish.`,
    access: "write",
    timeout: "5 minutes",
    input: Schema.Struct({ unit }),
    resource: (input) => input.unit,
    summary: (input) => `systemctl --user ${verb} ${input.unit}`,
    run: (input) => systemctl([verb, input.unit]),
  });

const enablement = (verb: "enable" | "disable") =>
  tool({
    name: `unit_${verb}`,
    description: `${verb === "enable" ? "Enable" : "Disable"} a user unit, optionally ${verb === "enable" ? "starting" : "stopping"} it now.`,
    access: "write",
    input: Schema.Struct({
      unit,
      now: Schema.optionalKey(Schema.Boolean),
    }),
    resource: (input) => input.unit,
    summary: (input) => `systemctl --user ${verb}${input.now ? " --now" : ""} ${input.unit}`,
    run: (input) => systemctl([verb, ...(input.now ? ["--now"] : []), input.unit]),
  });

/** User systemd units and their journal through systemctl and journalctl. */
export const systemdNamespace: ClientNamespace = {
  kind: "client",
  command: "systemd",
  description:
    "User systemd units through systemctl --user and journalctl --user: unit status, properties, files, failed units, timers and logs, verifying unit files, and starting, stopping, restarting, enabling or disabling units.",
  available: commandExists("systemctl"),
  tools: [
    tool({
      name: "unit_status",
      description: "Read a user unit's state, result, enablement, main PID, restart count and timestamps.",
      access: "read",
      pinned: true,
      input: Schema.Struct({ unit }),
      run: (input) =>
        Effect.map(systemctl(["show", input.unit, `--property=${statusProperties.join(",")}`]), properties),
    }),
    tool({
      name: "unit_list",
      description: "List loaded user units, or only failed ones, optionally matching glob patterns.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        failed: Schema.optionalKey(Schema.Boolean).annotate({ description: "Only failed units" }),
        all: Schema.optionalKey(Schema.Boolean).annotate({ description: "Include inactive units" }),
        patterns: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
          description: "Glob patterns such as dot-*",
        }),
      }),
      run: (input) =>
        systemctlJson([
          "list-units",
          "--output=json",
          ...(input.failed ? ["--failed"] : []),
          ...(input.all ? ["--all"] : []),
          ...(input.patterns ?? []),
        ]),
    }),
    tool({
      name: "timer_list",
      description: "List user timers with their last and next run times and the units they start.",
      access: "read",
      input: Schema.Struct({}),
      run: () =>
        systemctlJson(["list-timers", "--all", "--output=json"]).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Timers)),
          Effect.mapError(toToolError),
          Effect.map((timers) =>
            timers.map((timer) => ({
              unit: timer.unit,
              activates: timer.activates,
              next: microseconds(timer.next),
              last: microseconds(timer.last),
            })),
          ),
        ),
    }),
    tool({
      name: "logs",
      description:
        "Read the user journal, for one unit or all of them, with ISO timestamps. Returns an empty string when nothing matches.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        unit: Schema.optionalKey(unit),
        since: Schema.optionalKey(Schema.String).annotate({
          description: "A journalctl time, such as -1h, today or 2026-10-28 09:00",
        }),
        until: Schema.optionalKey(Schema.String),
        lines: Schema.optionalKey(Schema.Int).annotate({ description: "The newest lines to show, 200 by default" }),
        boot: Schema.optionalKey(Schema.Int).annotate({ description: "0 for this boot, -1 for the one before" }),
        priority: Schema.optionalKey(
          Schema.Literals(["emerg", "alert", "crit", "err", "warning", "notice", "info", "debug"]),
        ).annotate({ description: "This priority and more severe" }),
        grep: Schema.optionalKey(Schema.String).annotate({ description: "A regular expression the message must match" }),
      }),
      run: (input) => {
        const args = [
          "--user",
          "--no-pager",
          "--quiet",
          "--output=short-iso",
          `--lines=${input.lines ?? 200}`,
          ...(input.unit === undefined ? [] : [`--unit=${input.unit}`]),
          ...(input.since === undefined ? [] : [`--since=${input.since}`]),
          ...(input.until === undefined ? [] : [`--until=${input.until}`]),
          ...(input.boot === undefined ? [] : [`--boot=${input.boot}`]),
          ...(input.priority === undefined ? [] : [`--priority=${input.priority}`]),
          ...(input.grep === undefined ? [] : [`--grep=${input.grep}`]),
        ];

        return runCli("journalctl", args, { timeout: "1 minute" }).pipe(
          Effect.flatMap((run) => {
            if (run.exitCode === 0) return Effect.succeed(run.stdout.trimEnd());

            // journalctl exits 1 when a grep matches nothing
            if (run.exitCode === 1 && input.grep !== undefined && run.stdout.trim() === "")
              return Effect.succeed("");

            return Effect.fail(
              new Tool.Error({ message: `journalctl exited ${run.exitCode}\n${tailLines(run.stderr || run.stdout)}` }),
            );
          }),
        );
      },
    }),
    control("start"),
    control("stop"),
    control("restart"),
    tool({
      name: "daemon_reload",
      description: "Reload the user manager's unit files after they change.",
      access: "write",
      input: Schema.Struct({}),
      summary: () => "systemctl --user daemon-reload",
      run: () => systemctl(["daemon-reload"]),
    }),
    tool({
      name: "unit_cat",
      description: "Read a user unit's files as systemd loads them, with drop-ins.",
      access: "read",
      input: Schema.Struct({ unit }),
      run: (input) => systemctl(["cat", input.unit]),
    }),
    tool({
      name: "unit_show",
      description: "Read a user unit's properties, all of them or the ones named.",
      access: "read",
      input: Schema.Struct({
        unit,
        properties: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
          description: "Property names such as ExecStart or Environment",
        }),
      }),
      run: (input) =>
        Effect.map(
          systemctl([
            "show",
            input.unit,
            ...(input.properties === undefined ? [] : [`--property=${input.properties.join(",")}`]),
          ]),
          properties,
        ),
    }),
    tool({
      name: "unit_files",
      description: "List installed user unit files with their enablement, optionally matching glob patterns.",
      access: "read",
      input: Schema.Struct({
        patterns: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
          description: "Glob patterns such as dot-*",
        }),
      }),
      run: (input) => systemctlJson(["list-unit-files", "--output=json", ...(input.patterns ?? [])]),
    }),
    tool({
      name: "verify",
      description:
        "Check user unit files for errors with systemd-analyze verify. Returns its findings, empty when clean.",
      access: "read",
      input: Schema.Struct({
        units: Schema.Array(Schema.String).annotate({ description: "Unit names or unit file paths" }),
      }),
      run: (input) =>
        Effect.map(runCli("systemd-analyze", ["--user", "verify", ...input.units], { timeout: "1 minute" }), (run) => ({
          ok: run.exitCode === 0,
          output: (run.stderr + run.stdout).trim(),
        })),
    }),
    enablement("enable"),
    enablement("disable"),
  ],
};
