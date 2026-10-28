import { homedir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Tool } from "@opencode/schema/tool";
import { Clock, Duration, Effect, FileSystem, Option, Random, Schema } from "effect";
import {
  CliInput,
  type CliNamespace,
  type ClientNamespace,
  type ClientTool,
  clientTools,
  commandExists,
  runCli,
  tailLines,
} from "./tool";

const tool = clientTools(NodeServices.layer);

const jobsDirectory = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "codemode-jobs");

const jobDirectory = (id: string) => join(jobsDirectory, id);

/** How long finished jobs are kept before `start` prunes them. */
const keepFinished = Duration.days(7);

const Job = Schema.Struct({
  id: Schema.String,
  tool: Schema.String,
  command: Schema.Array(Schema.String),
  cwd: Schema.String,
  unit: Schema.String,
  startedAt: Schema.String,
  json: Schema.Boolean,
  exitCodes: Schema.Array(Schema.Number),
});

type Job = typeof Job.Type;

const decodeJob = Schema.decodeUnknownEffect(Schema.fromJsonString(Job));

const jobId = Schema.String.annotate({ description: "A job id from start or list" });

// Runs the command with the job's files, records its exit code and shows a Herdr notification.
const runner = `
dir=$1 label=$2 ok=$3
shift 3
input=/dev/null
[ -f "$dir/stdin" ] && input=$dir/stdin
"$@" <"$input" >"$dir/stdout" 2>"$dir/stderr"
code=$?
printf '%s\\n' "$code" >"$dir/exit"
case " $ok " in
  *" $code "*) result="finished, exit $code" sound=done ;;
  *) result="failed, exit $code" sound=request ;;
esac
herdr notification show "Code Mode job" --body "$label $result" --sound "$sound" >/dev/null 2>&1
exit "$code"
`;

/** A shell command that streams the job's stdout and stderr as they're written, then prints its exit code once it ends. */
const followCommand = (job: Job) => {
  const directory = jobDirectory(job.id);

  return [
    `tail -q -n +1 -F '${directory}/stdout' '${directory}/stderr' 2>/dev/null & t=$!`,
    `until [ -e '${directory}/exit' ] || ! systemctl --user is-active --quiet '${job.unit}'; do sleep 2; done`,
    `sleep 1`,
    `kill $t 2>/dev/null`,
    `wait $t 2>/dev/null`,
    `echo "${job.tool} ${job.id} exit $(cat '${directory}/exit' 2>/dev/null || echo stopped)"`,
  ].join("; ");
};

const readJob = Effect.fn("jobs.readJob")(function* (id: string) {
  const fs = yield* FileSystem.FileSystem;

  const text = yield* fs
    .readFileString(join(jobDirectory(id), "job.json"))
    .pipe(Effect.mapError(() => new Tool.Error({ message: `No job ${id}` })));

  return yield* decodeJob(text).pipe(
    Effect.mapError((error) => new Tool.Error({ message: `Job ${id} has a broken record: ${error.message}` })),
  );
});

const readOptional = (path: string) =>
  Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) => fs.readFileString(path)).pipe(
    Effect.option,
  );

/** A job's state: running, finished with an expected exit code, failed, or stopped before it could finish. */
const jobStatus = Effect.fn("jobs.status")(function* (job: Job) {
  const exit = yield* readOptional(join(jobDirectory(job.id), "exit"));

  if (Option.isSome(exit)) {
    const exitCode = Number(exit.value.trim());

    return { state: job.exitCodes.includes(exitCode) ? "finished" : "failed", exitCode } as const;
  }

  const active = yield* runCli("systemctl", ["--user", "is-active", job.unit], { timeout: "10 seconds" }).pipe(
    Effect.map((run) => ["active", "activating", "deactivating", "reloading"].includes(run.stdout.trim())),
    Effect.orElseSucceed(() => false),
  );

  return { state: active ? "running" : "stopped", exitCode: null } as const;
});

const tail = (text: Option.Option<string>, lines: number) =>
  Option.match(text, {
    onNone: () => "",
    onSome: (value) => value.trimEnd().split("\n").slice(-lines).join("\n"),
  });

const summary = (job: Job, status: { readonly state: string; readonly exitCode: number | null }) => ({
  id: job.id,
  tool: job.tool,
  command: job.command.join(" "),
  cwd: job.cwd,
  startedAt: job.startedAt,
  ...status,
});

/** The job's result once it has ended: stdout, decoded when the tool prints JSON, and the end of stderr. */
const jobResult = Effect.fn("jobs.result")(function* (job: Job) {
  const directory = jobDirectory(job.id);
  const stdout = Option.getOrElse(yield* readOptional(join(directory, "stdout")), () => "");
  const stderr = Option.getOrElse(yield* readOptional(join(directory, "stderr")), () => "");

  const output = job.json
    ? Option.getOrElse(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(stdout), () => stdout)
    : stdout.trimEnd();

  return { output, stderr: tailLines(stderr) };
});

const prune = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const now = yield* Clock.currentTimeMillis;
  const ids = yield* fs.readDirectory(jobsDirectory).pipe(Effect.orElseSucceed(() => []));

  yield* Effect.forEach(
    ids,
    (id) =>
      fs.stat(join(jobDirectory(id), "exit")).pipe(
        Effect.flatMap((info) =>
          Option.exists(info.mtime, (mtime) => now - mtime.getTime() > Duration.toMillis(keepFinished))
            ? fs.remove(jobDirectory(id), { recursive: true })
            : Effect.void,
        ),
        Effect.ignore,
      ),
    { discard: true },
  );
}).pipe(Effect.withSpan("jobs.prune"));

const StartInput = Schema.Struct({
  tool: Schema.String.annotate({
    description: "The tool to run, as namespace.tool, such as dot.pr_watch, gh.run_watch or mise.run. Only CLI-backed namespaces",
  }),
  input: Schema.optionalKey(CliInput).annotate({ description: "That tool's input" }),
  timeoutMinutes: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1440 }))).annotate({
    description: "Stop the job after this many minutes (default: the tool's own timeout)",
  }),
});

/**
 * Start a CLI-backed tool as a detached job. The call asks or runs exactly as the tool it starts
 * would, so its permission is that tool's.
 */
const startTool = (namespaces: readonly CliNamespace[]): ClientTool => ({
  name: "start",
  description:
    "Start a CLI-backed Code Mode tool as a detached job and return its id at once. It keeps running through OpenCode restarts and shows a Herdr notification when it ends. Run the returned follow command, unchanged, in a background shell: it streams the job's output live and its end wakes the session. Don't wait on the job in the same turn.",
  access: "write",
  pinned: true,
  timeout: "30 seconds",
  input: StartInput,
  prepare: (raw, context) =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknownEffect(StartInput)(raw).pipe(
        Effect.mapError((error) => new Tool.Error({ message: `Invalid input for start: ${error.message}` })),
      );

      const [namespaceName = "", toolName = ""] = input.tool.split(/\.(.*)/s);
      const namespace = namespaces.find((entry) => entry.command === namespaceName);
      const target = namespace?.tools.find((entry) => entry.name === toolName);

      if (namespace === undefined || target === undefined)
        return yield* Effect.fail(
          new Tool.Error({
            message: `No CLI-backed tool ${input.tool}. Jobs can run tools from: ${namespaces.map((entry) => entry.command).join(", ")}`,
          }),
        );

      const invocation = yield* target.invocation(input.input ?? {});
      const command = [namespace.command, ...invocation.args];

      const timeout =
        input.timeoutMinutes === undefined
          ? Duration.fromInputUnsafe(target.timeout)
          : Duration.minutes(input.timeoutMinutes);

      const run = Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const now = yield* Clock.currentTimeMillis;
        const suffix = (yield* Random.nextIntBetween(0, 36 ** 4)).toString(36).padStart(4, "0");
        const stamp = new Date(now).toISOString().replace(/\D/g, "").slice(0, 14);
        const id = `${namespace.command}-${target.name}-${stamp}-${suffix}`;
        const directory = jobDirectory(id);

        const job: Job = {
          id,
          tool: `${namespace.command}.${target.name}`,
          command,
          cwd: context.directory,
          unit: `codemode-job-${id}.service`,
          startedAt: new Date(now).toISOString(),
          json: target.json,
          exitCodes: target.exitCodes ?? [0],
        };

        yield* prune;
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* fs.writeFileString(join(directory, "job.json"), `${JSON.stringify(job, null, 2)}\n`);

        if (invocation.stdin !== undefined) yield* fs.writeFileString(join(directory, "stdin"), invocation.stdin);

        const started = yield* runCli(
          "systemd-run",
          [
            "--user",
            "--quiet",
            "--collect",
            `--unit=${job.unit}`,
            `--description=Code Mode job ${job.tool}`,
            `--working-directory=${context.directory}`,
            `--setenv=PATH=${process.env.PATH ?? ""}`,
            "--setenv=NO_COLOR=1",
            `--property=RuntimeMaxSec=${Math.ceil(Duration.toSeconds(timeout))}`,
            "bash",
            "-c",
            runner,
            "codemode-job",
            directory,
            job.tool,
            job.exitCodes.join(" "),
            ...command,
          ],
          { timeout: "20 seconds" },
        );

        if (started.exitCode !== 0) {
          yield* fs.remove(directory, { recursive: true }).pipe(Effect.ignore);

          return yield* Effect.fail(
            new Tool.Error({ message: `systemd-run exited ${started.exitCode}\n${tailLines(started.stderr)}` }),
          );
        }

        return {
          id,
          tool: job.tool,
          command: command.join(" "),
          follow: followCommand(job),
          stdout: join(directory, "stdout"),
          stderr: join(directory, "stderr"),
        };
      }).pipe(
        Effect.provide(NodeServices.layer),
        Effect.mapError((error) =>
          error instanceof Tool.Error ? error : new Tool.Error({ message: `Could not start the job: ${String(error)}`, error }),
        ),
      );

      return {
        summary: `jobs start ${command.join(" ")}`,
        access: target.access,
        permission: { namespace: namespace.command, tool: target.name },
        run,
      };
    }),
});

/** Detached jobs running CLI-backed tools from the other namespaces. */
export const jobsNamespace = (namespaces: readonly CliNamespace[]): ClientNamespace => ({
  kind: "client",
  command: "jobs",
  description:
    "Detached jobs for long CLI-backed tools such as dot.pr_watch, gh.run_watch or mise.run: start one and get its id at once, then list jobs, read a job's output while it runs, wait a bounded time for it to end, or stop it. Jobs keep running through OpenCode restarts.",
  available: commandExists("systemd-run"),
  tools: [
    startTool(namespaces),
    tool({
      name: "list",
      description: "List jobs, newest first, with their state: running, finished, failed or stopped.",
      access: "read",
      pinned: true,
      input: Schema.Struct({}),
      run: () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const ids = yield* fs.readDirectory(jobsDirectory).pipe(Effect.orElseSucceed(() => []));

          const jobs = yield* Effect.forEach(
            ids,
            (id) =>
              readJob(id).pipe(
                Effect.flatMap((job) => Effect.map(jobStatus(job), (status) => summary(job, status))),
                Effect.option,
              ),
            { concurrency: 8 },
          );

          return jobs
            .flatMap((job) => (Option.isSome(job) ? [job.value] : []))
            .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
        }),
    }),
    tool({
      name: "log",
      description: "Read the newest lines of a job's stdout and stderr, while it runs or after it ends.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        id: jobId,
        lines: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2000 }))).annotate({
          description: "The newest lines to show from each stream, 50 by default",
        }),
      }),
      run: (input) =>
        Effect.gen(function* () {
          const job = yield* readJob(input.id);
          const lines = input.lines ?? 50;

          return {
            ...summary(job, yield* jobStatus(job)),
            stdout: tail(yield* readOptional(join(jobDirectory(job.id), "stdout")), lines),
            stderr: tail(yield* readOptional(join(jobDirectory(job.id), "stderr")), lines),
          };
        }),
    }),
    tool({
      name: "wait",
      description:
        "Wait up to timeoutSeconds for a job to end, then return its state, and its output once it has ended. A timeout of 0 checks without waiting.",
      access: "read",
      timeout: "11 minutes",
      input: Schema.Struct({
        id: jobId,
        timeoutSeconds: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 600 }))).annotate({
          description: "How long to wait, 45 by default and 600 at most",
        }),
      }),
      run: (input) =>
        Effect.gen(function* () {
          const job = yield* readJob(input.id);
          const deadline = (yield* Clock.currentTimeMillis) + (input.timeoutSeconds ?? 45) * 1000;
          let status = yield* jobStatus(job);

          while (status.state === "running" && (yield* Clock.currentTimeMillis) < deadline) {
            yield* Effect.sleep("2 seconds");
            status = yield* jobStatus(job);
          }

          return status.state === "running"
            ? summary(job, status)
            : { ...summary(job, status), ...(yield* jobResult(job)) };
        }),
    }),
    tool({
      name: "stop",
      description: "Stop a running job.",
      access: "write",
      input: Schema.Struct({ id: jobId }),
      resource: (input) => input.id,
      summary: (input) => `jobs stop ${input.id}`,
      run: (input) =>
        Effect.gen(function* () {
          const job = yield* readJob(input.id);
          const stopped = yield* runCli("systemctl", ["--user", "stop", job.unit], { timeout: "1 minute" });

          if (stopped.exitCode !== 0)
            return yield* Effect.fail(
              new Tool.Error({ message: `systemctl stop exited ${stopped.exitCode}\n${tailLines(stopped.stderr)}` }),
            );

          return summary(job, yield* jobStatus(job));
        }),
    }),
  ],
});
