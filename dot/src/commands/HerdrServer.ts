import { Effect, Option, Schedule, Schema } from "effect";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readlinkSync,
  statSync,
} from "fs";
import { join } from "path";
import { ENV, envFlag } from "../lib/env.js";
import { STATE_DIR } from "../lib/paths.js";
import { formatCause } from "../lib/schema.js";
import {
  acquireWorkspaceMutationLock,
  releaseWorkspaceMutationLock,
} from "../lib/workspaceMutationLock.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";

class HerdrServerError extends Schema.TaggedError<HerdrServerError>()(
  "HerdrServerError",
  {
    message: Schema.String,
  },
) {}

const Sessions = Schema.fromJsonString(
  Schema.Struct({
    sessions: Schema.Array(
      Schema.Struct({
        default: Schema.Boolean,
        running: Schema.Boolean,
        socket_path: Schema.String,
      }),
    ),
  }),
);
const Panes = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      panes: Schema.Array(
        Schema.Struct({
          pane_id: Schema.String,
          tab_id: Schema.String,
          label: Schema.optional(Schema.NullOr(Schema.String)),
          cwd: Schema.optional(Schema.NullOr(Schema.String)),
          agent: Schema.optional(Schema.NullOr(Schema.String)),
          agent_status: Schema.String,
        }),
      ),
    }),
  }),
);
const ProcessInfo = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      process_info: Schema.Struct({
        shell_pid: Schema.NullOr(Schema.Finite),
        foreground_process_group_id: Schema.NullOr(Schema.Finite),
        foreground_processes: Schema.Array(
          Schema.Struct({
            pid: Schema.Finite,
            name: Schema.String,
            argv: Schema.Array(Schema.String),
          }),
        ),
      }),
    }),
  }),
);
const Snapshot = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      snapshot: Schema.Struct({ version: Schema.String }),
    }),
  }),
);
const ProcessRow = Schema.Tuple([
  Schema.FiniteFromString,
  Schema.FiniteFromString,
  Schema.FiniteFromString,
  Schema.FiniteFromString,
  Schema.FiniteFromString,
  Schema.String,
  Schema.String,
]);
const CommandFailure = Schema.fromJsonString(
  Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }),
);

type Process = {
  readonly parent: number;
  readonly session: number;
  readonly group: number;
  readonly foreground: number;
  readonly state: string;
  readonly name: string;
};

function cleanEnvironmentArgs() {
  return Object.keys(process.env)
    .filter((key) => key.startsWith("HERDR_"))
    .flatMap((key) => ["-u", key]);
}

const run = Effect.fn("HerdrServer.run")(function* (
  binary: string,
  args: readonly string[],
  socket?: string,
) {
  const executor = yield* CommandExecutor;
  return yield* executor
    .run("env", [
      ...cleanEnvironmentArgs(),
      ...(socket ? [`HERDR_SOCKET_PATH=${socket}`] : []),
      binary,
      ...args,
    ])
    .pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError(
        (error) =>
          new HerdrServerError({
            message:
              error._tag === "CommandError"
                ? Schema.decodeOption(CommandFailure)(error.stderr).pipe(
                    Option.map((response) => response.error.message),
                    Option.getOrElse(() => error.stderr || `${binary} failed.`),
                  )
                : `${binary} did not respond within 10 seconds.`,
          }),
      ),
    );
});

/** Resolve the local server PID so callers can use its matching CLI executable. */
export const herdrServerPid = Effect.fn("HerdrServer.pid")(function* (
  socket: string,
) {
  const result = (yield* run("fuser", [socket])).trim();
  if (!/^\d+$/.test(result)) {
    return yield* new HerdrServerError({
      message:
        "Cannot identify a single local Herdr server for the default socket.",
    });
  }
  const pid = Number(result);
  yield* Effect.try({
    try: () => {
      if (
        statSync(`/proc/${pid}`).uid !== process.getuid?.() ||
        !readlinkSync(`/proc/${pid}/exe`)
          .replace(/ \(deleted\)$/, "")
          .endsWith("/herdr")
      ) {
        throw new Error(
          "Cannot identify the Herdr server executable for this user.",
        );
      }
    },
    catch: (error) => new HerdrServerError({ message: formatCause(error) }),
  });
  return pid;
});

function descendants(pid: number, processes: ReadonlyMap<number, Process>) {
  const found = new Set([pid]);
  let previous = 0;
  while (previous !== found.size) {
    previous = found.size;
    for (const [child, info] of processes) {
      if (found.has(info.parent)) found.add(child);
    }
  }
  found.delete(pid);
  return found;
}

const checkPanes = Effect.fn("HerdrServer.checkPanes")(function* (
  pid: number,
  socket: string,
  action: "stop" | "restart",
) {
  // The running executable still speaks the old protocol after a mise upgrade.
  const binary = `/proc/${pid}/exe`;
  const {
    result: { panes },
  } = yield* Schema.decodeEffect(Panes)(
    yield* run(binary, ["pane", "list"], socket),
  );
  const infos = yield* Effect.forEach(panes, (pane) =>
    run(binary, ["pane", "process-info", "--pane", pane.pane_id], socket).pipe(
      Effect.flatMap(Schema.decodeEffect(ProcessInfo)),
      Effect.map((response) => ({ pane, info: response.result.process_info })),
    ),
  );
  const rows = yield* run("ps", [
    "-e",
    "-o",
    "pid=,ppid=,sid=,pgid=,tpgid=,stat=,comm=",
  ]);
  const processes = new Map<number, Process>();
  for (const row of rows.trim().split("\n")) {
    const match = row
      .trim()
      .match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(.+)$/);
    const [child, parent, session, group, foreground, state, name] =
      yield* Schema.decodeUnknownEffect(ProcessRow)(match?.slice(1));
    processes.set(child, { parent, session, group, foreground, state, name });
  }
  if (!processes.has(pid)) {
    return yield* new HerdrServerError({
      message: `The Herdr server disappeared during the check. Run dot herdr ${action} again.`,
    });
  }
  const blockers: string[] = [];
  for (const { pane, info } of infos) {
    const shell = info.shell_pid;
    const processInfo = shell === null ? undefined : processes.get(shell);
    const label = `${pane.pane_id} (${JSON.stringify(pane.label || pane.cwd || pane.tab_id)})`;
    const children =
      shell === null ? new Set<number>() : descendants(shell, processes);
    if (pane.agent) {
      blockers.push(`${label}: ${pane.agent} agent (${pane.agent_status})`);
    } else if (!processInfo) {
      blockers.push(`${label}: cannot identify the pane's shell`);
    } else if (
      info.foreground_process_group_id !== processInfo.group ||
      processInfo.foreground !== processInfo.group ||
      info.foreground_processes.length !== 1 ||
      info.foreground_processes[0]?.pid !== shell
    ) {
      blockers.push(
        `${label}: foreground command: ${info.foreground_processes.map((item) => item.name).join(", ") || "unknown"}`,
      );
    } else if (
      !["sh", "bash", "zsh", "fish", "dash", "ksh"].includes(
        processInfo.name,
      ) ||
      !processInfo.state.startsWith("S") ||
      !info.foreground_processes[0]?.argv.length ||
      info.foreground_processes[0].argv
        .slice(1)
        .some(
          (arg) =>
            !["-l", "-i", "-il", "-li", "--login", "--interactive"].includes(
              arg,
            ),
        )
    ) {
      blockers.push(`${label}: cannot confirm an idle interactive shell`);
    } else {
      for (const [child, job] of processes) {
        if (
          child !== shell &&
          (children.has(child) || job.session === processInfo.session)
        ) {
          blockers.push(`${label}: job: ${job.name} (PID ${child})`);
        }
      }
    }
  }
  if (blockers.length) {
    return yield* new HerdrServerError({
      message: `Herdr is not ready to ${action}:\n${blockers.map((item) => `  - ${item}`).join("\n")}\nClose these agents or finish these jobs, then run dot herdr ${action} again.`,
    });
  }
  return infos
    .map(({ pane, info }) => `${pane.pane_id}:${info.shell_pid}`)
    .sort();
});

const launch = Effect.gen(function* () {
  const logPath = join(STATE_DIR, "herdr-restart.log");
  return yield* Effect.try({
    try: () => {
      mkdirSync(STATE_DIR, { recursive: true });
      const log = openSync(logPath, "a", 0o600);
      try {
        const child = Bun.spawn(
          [
            "env",
            ...cleanEnvironmentArgs(),
            "uwsm-app",
            "-s",
            "b",
            "--",
            "env",
            "USAGEBAR_DISABLE_BROWSER_COOKIES=1",
            "herdr",
            "server",
          ],
          {
            stdin: "ignore",
            stdout: log,
            stderr: log,
            detached: true,
          },
        );
        child.unref();
        return child;
      } finally {
        closeSync(log);
      }
    },
    catch: (error) =>
      new HerdrServerError({
        message: `Could not launch Herdr: ${formatCause(error)}. See ${logPath}.`,
      }),
  });
}).pipe(Effect.withSpan("HerdrServer.launch"));

const reportError = Effect.fn("HerdrServer.reportError")(function* (error: {
  readonly message: string;
}) {
  const output = yield* OutputLog;
  yield* output.error(error.message);
  process.exitCode = 1;
});

/** Start the default Herdr server with the desktop autostart launch context. */
export const herdrStart = launch.pipe(
  Effect.asVoid,
  Effect.catchTag("HerdrServerError", reportError),
);

/** Stop or restart the default server only when idle shell panes remain. */
export const herdrServerAction = Effect.fn("herdrServerAction")(
  function* (action: "stop" | "restart", options: { readonly check: boolean }) {
    const output = yield* OutputLog;
    if (!options.check && envFlag(ENV.HERDR_ENV)) {
      return yield* new HerdrServerError({
        message: `Run dot herdr ${action} from a terminal outside Herdr. Use --check here to list blockers.`,
      });
    }
    for (const command of [
      "herdr",
      "fuser",
      "ps",
      ...(action === "restart" && !options.check ? ["uwsm-app"] : []),
    ]) {
      if (!Bun.which(command))
        return yield* new HerdrServerError({
          message: `Missing command: ${command}.`,
        });
    }
    yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          acquireWorkspaceMutationLock(
            (message) =>
              new HerdrServerError({
                message: message.replaceAll(
                  "workspace mutation",
                  "Herdr server change",
                ),
              }),
            join(STATE_DIR, "dot", "herdr-server.lock"),
          ),
        catch: (error) => new HerdrServerError({ message: formatCause(error) }),
      }),
      (path) => Effect.sync(() => releaseWorkspaceMutationLock(path)),
    );
    const { sessions } = yield* Schema.decodeEffect(Sessions)(
      yield* run("herdr", ["session", "list", "--json"]),
    );
    const session = sessions.find((item) => item.default);
    if (!session?.running)
      return yield* new HerdrServerError({
        message:
          "The default Herdr server is not running. Start it with dot herdr start.",
      });
    const pid = yield* herdrServerPid(session.socket_path);
    const panes = yield* checkPanes(pid, session.socket_path, action);
    if (options.check) {
      yield* output.info(
        `Herdr is ready to ${action}: ${panes.length} idle shell pane(s).`,
      );
      return;
    }
    if (
      (yield* herdrServerPid(session.socket_path)) !== pid ||
      JSON.stringify(yield* checkPanes(pid, session.socket_path, action)) !==
        JSON.stringify(panes)
    ) {
      return yield* new HerdrServerError({
        message: `Herdr changed during the check. Run dot herdr ${action} again.`,
      });
    }
    yield* output.info(
      `Herdr is clean. ${action === "restart" ? "Restarting" : "Stopping"} the default server...`,
    );
    yield* run(`/proc/${pid}/exe`, ["server", "stop"], session.socket_path);
    yield* Effect.sync(() => !existsSync(`/proc/${pid}`)).pipe(
      Effect.filterOrFail(
        (exited) => exited,
        () =>
          new HerdrServerError({
            message:
              "The Herdr server has not exited. Check herdr status before trying again.",
          }),
      ),
      Effect.retry(
        Schedule.recurs(99).pipe(
          Schedule.addDelay(() => Effect.succeed("100 millis")),
        ),
      ),
    );
    if (action === "stop") {
      yield* output.info("Herdr stopped.");
      return;
    }
    const child = yield* launch;
    const ready = Effect.gen(function* () {
      if (child.exitCode !== null && child.exitCode !== 0)
        return yield* new HerdrServerError({
          message: "Herdr failed to start.",
        });
      if ((yield* herdrServerPid(session.socket_path)) === pid)
        return yield* new HerdrServerError({
          message: "The old server is still running.",
        });
      return yield* Schema.decodeEffect(Snapshot)(
        yield* run("herdr", ["api", "snapshot"], session.socket_path),
      );
    });
    const response = yield* ready.pipe(
      Effect.retry(
        Schedule.recurs(74).pipe(
          Schedule.addDelay(() => Effect.succeed("200 millis")),
        ),
      ),
      Effect.timeout("15 seconds"),
      Effect.mapError(
        () =>
          new HerdrServerError({
            message: `Herdr has not become ready. See ${join(STATE_DIR, "herdr-restart.log")}.`,
          }),
      ),
    );
    yield* output.info(
      `Herdr restarted (v${response.result.snapshot.version}). Reattach with Super+Q.`,
    );
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.catchTags({
        HerdrServerError: reportError,
        SchemaError: () =>
          reportError({
            message:
              "Cannot read Herdr's pane or process details. Operation refused.",
          }),
      }),
    ),
);
