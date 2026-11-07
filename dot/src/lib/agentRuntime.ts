import { Effect, FileSystem, Option, Result, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { dirname, join, resolve } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { GLOBAL_PLUGINS } from "./opencodePlugins.js";
import { HOME_DIR, STATE_DIR } from "./paths.js";
import { plural } from "./runSummary.js";
import { notable, skip, warn } from "./updateSummary.js";

const OPENCODE = join(HOME_DIR, ".local", "bin", "opencode2");

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
 * binary, such as the brief watcher's long-lived `plannotator inbox mcp`.
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

/**
 * Plannotator's agent plugins, unpinned, which only move to the version the
 * Plannotator CLI is on. mise holds the CLI back by its minimum release age,
 * so all three change in the same update.
 */
const PLANNOTATOR_PLUGINS = {
  opencode: "@plannotator/opencode",
  pi: "npm:@plannotator/pi-extension",
} as const;

const NpmLatest = Schema.Struct({ version: Schema.String });

/** Pi packages from `pi list`, by their source. */
const piPackages = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  return (yield* executor.run("pi", ["list"]))
    .split("\n")
    .flatMap((line) => /^ {2}(\S+:\S+)$/.exec(line)?.[1] ?? []);
});

const PackageVersion = Schema.fromJsonString(
  Schema.Struct({ version: Schema.optionalKey(Schema.String) }),
);

/**
 * Each Pi package's installed revision: the commit of a git package and the
 * version of an npm one, keyed by source.
 */
const piPackageRevisions = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const lines = (yield* executor.run("pi", ["list"])).split("\n");
  const revisions = new Map<string, string>();

  for (const [index, line] of lines.entries()) {
    const source = /^ {2}(\S+:\S+)$/.exec(line)?.[1];
    const path = lines[index + 1]?.trim();

    if (!source || !path) continue;

    revisions.set(
      source,
      source.startsWith("git:")
        ? yield* executor
            .run("git", ["rev-parse", "HEAD"], { cwd: path })
            .pipe(Effect.orElseSucceed(() => ""))
        : yield* fs.readFileString(join(path, "package.json")).pipe(
            Effect.flatMap(Schema.decodeEffect(PackageVersion)),
            Effect.map((pkg) => pkg.version ?? ""),
            Effect.orElseSucceed(() => ""),
          ),
    );
  }

  return revisions;
});

/** Update installed Pi packages, leaving Plannotator's to its CLI version. */
export const updatePiExtensions = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  if (Bun.which("pi") === null)
    return skip("Pi extensions skipped (pi not installed)");

  const sources = (yield* piPackages).filter(
    (source) => source !== PLANNOTATOR_PLUGINS.pi,
  );

  const before = yield* piPackageRevisions;
  const failed: string[] = [];

  for (const source of sources) {
    if ((yield* executor.exitCode("pi", ["update", source])) !== 0)
      failed.push(source);
  }

  if (failed.length) {
    yield* log.warn(`Pi extension update failed: ${failed.join(", ")}`);

    return warn(`Pi extension update failed: ${failed.join(", ")}`);
  }

  const after = yield* piPackageRevisions;

  const moved = sources.filter(
    (source) => before.get(source) !== after.get(source),
  );

  if (!moved.length) {
    yield* log.info("Pi extensions are up to date");

    return skip("Pi extensions already up to date");
  }

  yield* log.success(`Updated Pi extensions: ${moved.join(", ")}`);

  return notable(`Updated ${plural(moved.length, "Pi extension")}`);
}).pipe(
  Effect.catch((error) =>
    Effect.succeed(warn(`Pi extension update failed: ${error.message}`)),
  ),
  Effect.withSpan("agentRuntime.updatePiExtensions"),
);

/**
 * Move Plannotator's OpenCode plugin and Pi extension to the latest release
 * once the Plannotator CLI mise installed is on it too, so a release newer
 * than mise's minimum release age waits for the next update.
 */
export const updatePlannotatorPlugins = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const http = yield* HttpClient.HttpClient;
  const log = yield* OutputLog;

  if (Bun.which("plannotator") === null)
    return skip("Plannotator plugins skipped (plannotator not installed)");

  const cli = /\d+\.\d+\.\d+\S*/.exec(
    yield* executor.run("plannotator", ["--version"], { cwd: HOME_DIR }),
  )?.[0];

  if (cli === undefined)
    return warn("Plannotator plugins skipped (unknown CLI version)");

  const latest = Effect.fn("agentRuntime.npmLatest")(function* (name: string) {
    const response = yield* http
      .get(`https://registry.npmjs.org/${name}/latest`)
      .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));

    return (yield* Schema.decodeUnknownEffect(NpmLatest)(yield* response.json))
      .version;
  });

  const updated: string[] = [];
  const current: string[] = [];
  const waiting: string[] = [];
  const failed: string[] = [];

  const follow = Effect.fn("agentRuntime.followPlannotator")(function* <E, R>(
    name: string,
    update: Effect.Effect<"updated" | "current" | "failed", E, R>,
  ) {
    const version = yield* latest(name);

    if (version !== cli) {
      yield* log.info(
        `${name} ${version} waits for the Plannotator CLI (on ${cli})`,
      );
      waiting.push(name);

      return;
    }

    const outcome = yield* update;

    if (outcome === "updated") updated.push(name);
    else if (outcome === "current") current.push(name);
    else failed.push(name);
  });

  if ((yield* executor.exitCode(OPENCODE, ["service", "status"])) === 0) {
    yield* follow(
      PLANNOTATOR_PLUGINS.opencode,
      Effect.gen(function* () {
        // `plugin check` names the package without its scope.
        const outdated = (yield* executor
          .run(OPENCODE, ["plugin", "check"])
          .pipe(Effect.orElseSucceed(() => "")))
          .split("\n")
          .some((line) => /^\s*plannotator\s.*update available/.test(line));

        if (!outdated) return "current" as const;

        return (yield* executor.exitCode(OPENCODE, [
          "plugin",
          "update",
          PLANNOTATOR_PLUGINS.opencode,
        ])) === 0
          ? ("updated" as const)
          : ("failed" as const);
      }),
    );
  }

  if (
    Bun.which("pi") !== null &&
    (yield* piPackages).includes(PLANNOTATOR_PLUGINS.pi)
  ) {
    yield* follow(
      PLANNOTATOR_PLUGINS.pi.replace(/^npm:/, ""),
      Effect.gen(function* () {
        const before = (yield* piPackageRevisions).get(PLANNOTATOR_PLUGINS.pi);

        if (
          (yield* executor.exitCode("pi", [
            "update",
            PLANNOTATOR_PLUGINS.pi,
          ])) !== 0
        )
          return "failed" as const;

        return (yield* piPackageRevisions).get(PLANNOTATOR_PLUGINS.pi) ===
          before
          ? ("current" as const)
          : ("updated" as const);
      }),
    );
  }

  if (failed.length)
    return warn(`Could not update Plannotator plugins: ${failed.join(", ")}`);

  if (updated.length) {
    yield* log.success(`Updated ${updated.join(", ")} to ${cli}`);

    return notable(`Plannotator plugins follow CLI ${cli}`);
  }

  if (waiting.length)
    return skip(`Plannotator plugins wait for the CLI to reach their release`);

  return current.length
    ? skip(`Plannotator plugins already on CLI ${cli}`)
    : skip("Plannotator plugins skipped (none installed)");
}).pipe(
  Effect.catch((error) =>
    Effect.succeed(warn(`Plannotator plugin update failed: ${error.message}`)),
  ),
  Effect.provide(FetchHttpClient.layer),
  Effect.withSpan("agentRuntime.updatePlannotatorPlugins"),
);

/**
 * Move the global OpenCode plugins to their branch heads. OpenCode keeps a
 * Git plugin on the commit it first installed until asked to update it.
 */
export const updateGlobalOpencodePlugins = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  if ((yield* executor.exitCode(OPENCODE, ["service", "status"])) !== 0)
    return skip("OpenCode plugins skipped (service not running)");

  const updated: string[] = [];
  const failed: string[] = [];

  for (const spec of GLOBAL_PLUGINS) {
    const output = yield* executor
      .run(OPENCODE, ["plugin", "update", spec], { cwd: HOME_DIR })
      .pipe(Effect.result);

    if (Result.isFailure(output)) {
      yield* log.warn(
        `${spec}: ${output.failure.stderr.trim() || `exit ${output.failure.exitCode}`}`,
      );
      failed.push(spec);
    } else if (/^Updated /m.test(output.success)) updated.push(spec);
  }

  if (failed.length)
    return warn(`Could not update OpenCode plugins: ${failed.join(", ")}`);

  if (updated.length) {
    yield* log.success(`Updated ${updated.join(", ")}`);

    return notable(
      `Updated ${plural(updated.length, "OpenCode plugin")} to their branch heads`,
    );
  }

  return skip("OpenCode plugins already current");
}).pipe(Effect.withSpan("agentRuntime.updateGlobalOpencodePlugins"));

/** Reload the OpenCode 2 background service's configuration when it is running. */
const reloadOpenCode = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  if ((yield* executor.exitCode(OPENCODE, ["service", "status"])) !== 0) {
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

/** Where `dot up` asks Pi's `dot-reload` extension to reload. */
const PI_RELOAD_REQUEST = join(STATE_DIR, "dot", "agent-reload");

/**
 * Ask running Pi sessions to reload by writing a new stamp that the
 * `dot-reload` extension watches. Each session reloads once it settles,
 * through the extension API, so a half-typed prompt is never touched.
 */
const requestPiReload = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const log = yield* OutputLog;

  yield* fs.makeDirectory(dirname(PI_RELOAD_REQUEST), { recursive: true });
  yield* fs.writeFileString(PI_RELOAD_REQUEST, `${Date.now()}\n`);
  yield* log.success("Queued a reload for Pi sessions");
}).pipe(Effect.withSpan("agentRuntime.requestPiReload"));

/**
 * Reload running agents so they load updated plugins and skills: the OpenCode
 * service through its CLI, and Pi sessions through their `dot-reload`
 * extension once they settle. Claude Code watches its skills itself.
 */
export const reloadAgents = Effect.gen(function* () {
  const log = yield* OutputLog;

  const [openCode, piQueued] = yield* Effect.all(
    [
      reloadOpenCode,
      requestPiReload.pipe(
        Effect.as(true),
        Effect.catchCause(() =>
          log.warn("Could not queue the Pi reload").pipe(Effect.as(false)),
        ),
      ),
    ],
    { concurrency: "unbounded" },
  );

  const parts = [
    ...(openCode === "reloaded" ? ["reloaded the OpenCode service"] : []),
    ...(piQueued ? ["queued a reload for Pi sessions"] : []),
  ];

  if (openCode === "failed")
    return warn(
      `OpenCode reload failed${parts.length ? `; ${parts.join(", ")}` : ""}`,
    );

  if (parts.length === 0) return skip("No running agents to reload");

  const summary = parts.join(" and ");

  return notable(`${summary.charAt(0).toUpperCase()}${summary.slice(1)}`);
}).pipe(Effect.withSpan("agentRuntime.reloadAgents"));
