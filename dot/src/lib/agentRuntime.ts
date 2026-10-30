import { HerdrSdk, herdrSdkLayerFromOptions } from "@timmo001/effect-herdr";
import { Duration, Effect, FileSystem, Option, Schema } from "effect";
import { dirname, resolve } from "path";
import { DEFAULT_SOCKET_PATH } from "../commands/HerdrRepoOpen.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { ENV, envString } from "./env.js";
import { plural } from "./runSummary.js";
import { done, notable, skip, warn } from "./updateSummary.js";

/** The app's own OpenCode, on PATH. The desktop's wrapper isn't stowed here. */
const OPENCODE = "opencode2";

/** In-session reload command for each agent Herdr can type into. */
const AGENT_RELOAD_COMMANDS = {
  claude: "/reload-plugins",
  pi: "/reload",
} as const;

type ReloadableAgent = keyof typeof AGENT_RELOAD_COMMANDS;

const isReloadableAgent = (agent: string): agent is ReloadableAgent =>
  Object.hasOwn(AGENT_RELOAD_COMMANDS, agent);

const PitchforkDaemons = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({ id: Schema.String, pid: Schema.NullOr(Schema.Finite) }),
  ),
);

const MiseCurrentTools = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Array(Schema.Struct({ install_path: Schema.String })),
  ),
);

const DELETED_SUFFIX = " (deleted)";

/** Install directories mise resolves in `cwd`, and the installs root above them. */
const miseInstalls = Effect.fn("agentRuntime.miseInstalls")(function* (
  cwd: string,
) {
  const executor = yield* CommandExecutor;

  const tools = yield* executor
    .run("mise", ["ls", "--current", "--json"], { cwd })
    .pipe(Effect.flatMap(Schema.decodeEffect(MiseCurrentTools)));

  const paths = Object.values(tools).flatMap((versions) =>
    versions.map((version) => version.install_path),
  );

  const [first] = paths;

  return first === undefined
    ? undefined
    : { root: dirname(dirname(first)), paths };
});

type InstallsByCwd = Map<
  string,
  Effect.Success<ReturnType<typeof miseInstalls>> | undefined
>;

/**
 * Whether a process runs a mise-installed binary other than the version mise
 * now resolves in its working directory. A process launched by a path that
 * already resolves to its binary doesn't count: relaunching it can't help.
 */
const runsStaleMiseBinary = Effect.fn("agentRuntime.runsStaleMiseBinary")(
  function* (pid: number, installsByCwd: InstallsByCwd) {
    const fs = yield* FileSystem.FileSystem;

    const exe = yield* fs.readLink(`/proc/${pid}/exe`).pipe(Effect.option);
    const cwd = yield* fs.readLink(`/proc/${pid}/cwd`).pipe(Effect.option);

    if (Option.isNone(exe) || Option.isNone(cwd)) return false;

    if (!installsByCwd.has(cwd.value)) {
      installsByCwd.set(
        cwd.value,
        yield* miseInstalls(cwd.value).pipe(
          Effect.orElseSucceed(() => undefined),
        ),
      );
    }

    const installs = installsByCwd.get(cwd.value);
    const deleted = exe.value.endsWith(DELETED_SUFFIX);

    const path = deleted
      ? exe.value.slice(0, -DELETED_SUFFIX.length)
      : exe.value;

    if (!installs || !path.startsWith(`${installs.root}/`)) return false;

    if (!deleted && installs.paths.some((dir) => path.startsWith(`${dir}/`)))
      return false;

    // A process launched by path, such as a virtual environment's python,
    // relaunches on the same binary
    const [launcher = ""] = (yield* fs
      .readFileString(`/proc/${pid}/cmdline`)
      .pipe(Effect.orElseSucceed(() => ""))).split("\0");

    return !(
      !deleted &&
      launcher.includes("/") &&
      (yield* fs
        .realPath(resolve(cwd.value, launcher))
        .pipe(Effect.orElseSucceed(() => undefined))) === path
    );
  },
);

/**
 * Restart running pitchfork daemons whose process is a mise-installed binary
 * other than the version mise now resolves in the daemon's directory, so
 * pitchfork relaunches them on the current install.
 */
export const restartStalePitchforkDaemons = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  if (Bun.which("pitchfork") === null)
    return skip("Pitchfork daemons skipped (pitchfork not installed)");

  const daemons = yield* executor
    .run("pitchfork", ["list", "--json", "--status", "running"])
    .pipe(Effect.flatMap(Schema.decodeEffect(PitchforkDaemons)));

  const installsByCwd: InstallsByCwd = new Map();
  const stale: string[] = [];

  for (const { id, pid } of daemons) {
    if (pid !== null && (yield* runsStaleMiseBinary(pid, installsByCwd)))
      stale.push(id);
  }

  if (!stale.length) {
    yield* log.info("Pitchfork daemons are on current mise tools");

    return skip("Pitchfork daemons already on current mise tools");
  }

  const failed: string[] = [];

  for (const id of stale) {
    const exitCode = yield* executor.exitCode("pitchfork", ["restart", id]);

    if (exitCode === 0) {
      yield* log.success(`Restarted ${id} on its current mise tools`);
    } else {
      yield* log.warn(`Could not restart ${id} (exit ${exitCode})`);
      failed.push(id);
    }
  }

  return failed.length
    ? warn(`Could not restart pitchfork daemons: ${failed.join(", ")}`)
    : notable(`Restarted ${plural(stale.length, "pitchfork daemon")}`);
}).pipe(
  Effect.catch((error) =>
    Effect.succeed(warn(`Pitchfork daemon check failed: ${error.message}`)),
  ),
  Effect.withSpan("agentRuntime.restartStalePitchforkDaemons"),
);

/**
 * Restart running dot user services with a process on a superseded mise
 * binary.
 */
export const restartStaleServices = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const log = yield* OutputLog;

  const units = (yield* executor.run("systemctl", [
    "--user",
    "list-units",
    "dot-*.service",
    "--state=running",
    "--plain",
    "--no-legend",
  ]))
    .split("\n")
    .flatMap((line) => line.trim().split(/\s+/, 1))
    .filter((unit) => unit.endsWith(".service"));

  const installsByCwd: InstallsByCwd = new Map();
  const stale: string[] = [];

  for (const unit of units) {
    const cgroup = (yield* executor.run("systemctl", [
      "--user",
      "show",
      "--property=ControlGroup",
      "--value",
      unit,
    ])).trim();

    const pids = (yield* fs
      .readFileString(`/sys/fs/cgroup${cgroup}/cgroup.procs`)
      .pipe(Effect.orElseSucceed(() => "")))
      .split("\n")
      .filter(Boolean)
      .map(Number);

    for (const pid of pids) {
      if (yield* runsStaleMiseBinary(pid, installsByCwd)) {
        stale.push(unit);
        break;
      }
    }
  }

  if (!stale.length) {
    yield* log.info("dot services are on current mise tools");

    return skip("dot services already on current mise tools");
  }

  const failed: string[] = [];

  for (const unit of stale) {
    const exitCode = yield* executor.exitCode("systemctl", [
      "--user",
      "restart",
      unit,
    ]);

    if (exitCode === 0) {
      yield* log.success(`Restarted ${unit} on its current mise tools`);
    } else {
      yield* log.warn(`Could not restart ${unit} (exit ${exitCode})`);
      failed.push(unit);
    }
  }

  return failed.length
    ? warn(`Could not restart dot services: ${failed.join(", ")}`)
    : notable(`Restarted ${plural(stale.length, "dot service")}`);
}).pipe(
  Effect.catch((error) =>
    Effect.succeed(warn(`dot service check failed: ${error.message}`)),
  ),
  Effect.withSpan("agentRuntime.restartStaleServices"),
);

/** Pi packages from `pi list`, by their source. */
const piPackages = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  return (yield* executor.run("pi", ["list"]))
    .split("\n")
    .flatMap((line) => /^ {2}(\S+:\S+)$/.exec(line)?.[1] ?? []);
});

/** Update installed Pi packages. */
export const updatePiExtensions = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  if (Bun.which("pi") === null)
    return skip("Pi extensions skipped (pi not installed)");

  const sources = yield* piPackages;

  const failed: string[] = [];

  for (const source of sources) {
    if ((yield* executor.exitCode("pi", ["update", source])) !== 0)
      failed.push(source);
  }

  if (failed.length) {
    yield* log.warn(`Pi extension update failed: ${failed.join(", ")}`);

    return warn(`Pi extension update failed: ${failed.join(", ")}`);
  }

  yield* log.success("Updated Pi extensions");

  return done("Updated Pi extensions");
}).pipe(
  Effect.catch((error) =>
    Effect.succeed(warn(`Pi extension update failed: ${error.message}`)),
  ),
  Effect.withSpan("agentRuntime.updatePiExtensions"),
);

/** Reload the OpenCode 2 background service's configuration when it is running. */
const reloadOpenCode = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  const status = yield* executor
    .exitCode(OPENCODE, ["service", "status"])
    .pipe(Effect.orElseSucceed(() => undefined));

  if (status === undefined) {
    yield* log.warn(`OpenCode reload skipped (${OPENCODE} couldn't run)`);

    return "skipped" as const;
  }

  if (status !== 0) {
    yield* log.info("OpenCode reload skipped (service not running)");

    return "skipped" as const;
  }

  const exitCode = yield* executor.exitCode(OPENCODE, ["reload"]);

  if (exitCode !== 0) {
    yield* log.warn(`OpenCode reload failed (exit ${exitCode})`);

    return "failed" as const;
  }

  yield* log.success("Reloaded the OpenCode service");

  return "reloaded" as const;
}).pipe(Effect.withSpan("agentRuntime.reloadOpenCode"));

/**
 * Type each agent's reload command into its Herdr pane, only for idle
 * sessions so a working agent is never interrupted.
 */
const reloadHerdrAgents = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const log = yield* OutputLog;
  const reloaded: Record<ReloadableAgent, number> = { claude: 0, pi: 0 };
  let busy = 0;

  for (const agent of yield* herdr.agents.list()) {
    const kind = Option.getOrUndefined(agent.agent);

    if (kind === undefined || !isReloadableAgent(kind)) continue;

    if (agent.status !== "idle" && agent.status !== "done") {
      busy += 1;

      continue;
    }

    const command = AGENT_RELOAD_COMMANDS[kind];

    const sent = yield* herdr.agents
      .prompt({ paneId: agent.paneId }, { text: command })
      .pipe(
        Effect.as(true),
        Effect.catch((error) =>
          log
            .warn(
              `Could not send ${command} to ${agent.paneId}: ${error.message}`,
            )
            .pipe(Effect.as(false)),
        ),
      );

    if (!sent) continue;

    yield* log.success(`Sent ${command} to ${kind} in ${agent.paneId}`);
    reloaded[kind] += 1;
  }

  if (busy) yield* log.info(`Left ${plural(busy, "busy agent session")} alone`);

  return { ...reloaded, busy };
}).pipe(
  Effect.provide(
    herdrSdkLayerFromOptions({
      socketPath: envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH,
      requestTimeout: Duration.seconds(5),
    }),
  ),
  Effect.withSpan("agentRuntime.reloadHerdrAgents"),
);

/**
 * Reload running agents so they load updated plugins and skills: the OpenCode
 * service through its CLI, and idle Claude Code and Pi sessions through Herdr.
 */
export const reloadAgents = Effect.gen(function* () {
  const log = yield* OutputLog;

  const [openCode, sessions] = yield* Effect.all(
    [
      reloadOpenCode,
      reloadHerdrAgents.pipe(
        Effect.catchCause(() =>
          log
            .info("Agent session reload skipped (Herdr unavailable)")
            .pipe(Effect.as(undefined)),
        ),
      ),
    ],
    { concurrency: "unbounded" },
  );

  const parts = [
    ...(openCode === "reloaded" ? ["the OpenCode service"] : []),
    ...(sessions?.claude
      ? [plural(sessions.claude, "Claude Code session")]
      : []),
    ...(sessions?.pi ? [plural(sessions.pi, "Pi session")] : []),
  ];

  const busyNote = sessions?.busy
    ? ` (${plural(sessions.busy, "busy session")} left alone)`
    : "";

  if (openCode === "failed")
    return warn(
      `OpenCode reload failed${parts.length ? `; reloaded ${parts.join(", ")}` : ""}${busyNote}`,
    );

  return parts.length
    ? notable(`Reloaded ${parts.join(", ")}${busyNote}`)
    : skip(`No idle agent sessions to reload${busyNote}`);
}).pipe(Effect.withSpan("agentRuntime.reloadAgents"));
