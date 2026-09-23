import { Effect, Option, Schedule, Schema } from "effect";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";

const home = homedir();

const dataRoot = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");

const stateRoot = process.env.XDG_STATE_HOME ?? join(home, ".local", "state");

const cacheRoot = process.env.XDG_CACHE_HOME ?? join(home, ".cache");

const configRoot = process.env.XDG_CONFIG_HOME ?? join(home, ".config");

const data = join(dataRoot, "opencode");

const previousData = join(dataRoot, "opencode-v2", "opencode");

const archive = join(dataRoot, "opencode-v1-archive");

const state = join(stateRoot, "opencode");

const previousState = join(stateRoot, "opencode-v2", "opencode");

const cache = join(cacheRoot, "opencode");

const previousCache = join(cacheRoot, "opencode-v2", "runtime", "opencode");

const oldConfig = join(configRoot, "opencode", "cli.json");

const oldEnvironment = join(configRoot, "opencode", ".env");

const isolatedEnvironment = {
  XDG_DATA_HOME: join(dataRoot, "opencode-v2"),
  XDG_STATE_HOME: join(stateRoot, "opencode-v2"),
  XDG_CACHE_HOME: join(cacheRoot, "opencode-v2", "runtime"),
  XDG_CONFIG_HOME: join(cacheRoot, "opencode-v2", "runtime-config"),
  OPENCODE_CONFIG_DIR: join(configRoot, "opencode-v2", "cli"),
};

const unitEnvironment = [
  `--setenv=PATH=${process.env.PATH ?? "/usr/local/bin:/usr/bin"}`,
  `--setenv=XDG_DATA_HOME=${dataRoot}`,
  `--setenv=XDG_STATE_HOME=${stateRoot}`,
  `--setenv=XDG_CACHE_HOME=${cacheRoot}`,
  `--setenv=XDG_CONFIG_HOME=${configRoot}`,
];

function requirePath(path: string): void {
  if (!existsSync(path)) throw new Error(`Required path is missing: ${path}`);
}

function vacant(path: string): void {
  if (existsSync(path) || isSymlink(path))
    throw new Error(`Destination already exists: ${path}`);
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function archiveAndMove(
  current: string,
  next: string,
  destination: string,
): void {
  renameSync(current, destination);
  renameSync(next, current);
}

function inspectedServicePid(binary: string): number | undefined {
  const registration = join(previousState, "service.json");

  if (!existsSync(registration)) return;

  const info = Schema.decodeUnknownOption(
    Schema.Struct({ pid: Schema.Number }),
  )(JSON.parse(readFileSync(registration, "utf8")));

  if (
    Option.isNone(info) ||
    !Number.isSafeInteger(info.value.pid) ||
    info.value.pid <= 1
  ) {
    throw new Error(`Invalid old service registration: ${registration}`);
  }

  const pid = info.value.pid;
  const proc = `/proc/${pid}`;

  if (!existsSync(proc)) return;

  const command = readFileSync(join(proc, "cmdline"), "utf8").replaceAll(
    "\0",
    " ",
  );

  const environment = readFileSync(join(proc, "environ"), "utf8").split("\0");

  if (
    statSync(proc).uid !== process.getuid?.() ||
    realpathSync(join(proc, "exe")) !== realpathSync(binary) ||
    !command.includes("serve --service") ||
    !environment.includes(`XDG_DATA_HOME=${join(dataRoot, "opencode-v2")}`)
  ) {
    throw new Error(
      `Old service PID ${pid} is not the expected OpenCode service`,
    );
  }

  return pid;
}

/** Archive OpenCode 1 and promote the isolated OpenCode 2 runtime to default paths. */
export const migrateOpenCode = (check: boolean, execute: boolean) =>
  Effect.gen(function* () {
    const commands = yield* CommandExecutor;
    const oldDatabase = join(previousData, "opencode.db");

    if (!existsSync(oldDatabase)) {
      if (
        existsSync(join(archive, "opencode.db")) &&
        existsSync(join(data, "opencode.db")) &&
        !existsSync(previousData)
      ) {
        console.log("OpenCode data is already at the default paths.");

        return;
      }

      throw new Error(
        `No isolated OpenCode database found at ${oldDatabase}; nothing was changed.`,
      );
    }

    requirePath(join(data, "opencode.db"));
    requirePath(join(data, "auth.json"));
    requirePath(state);
    requirePath(previousState);
    requirePath(cache);
    requirePath(previousCache);
    vacant(archive);
    vacant(join(stateRoot, "opencode-v1-archive"));
    vacant(join(cacheRoot, "opencode-v1-archive"));

    if (existsSync(oldConfig)) vacant(join(archive, "cli.json"));

    if (existsSync(oldEnvironment)) vacant(join(archive, ".env"));

    const linkedAuth = join(previousData, "auth.json");

    if (
      !isSymlink(linkedAuth) ||
      readlinkSync(linkedAuth) !== join(data, "auth.json")
    ) {
      throw new Error(`Unexpected OpenCode auth link: ${linkedAuth}`);
    }

    const version = yield* commands.run("mise", ["which", "opencode2"]);
    const binary = version.trim();
    const pid = inspectedServicePid(binary);

    const schema = yield* commands.run("sqlite3", [
      "-readonly",
      oldDatabase,
      "SELECT name FROM sqlite_master WHERE name='session_v2'",
    ]);

    if (schema.trim() !== "session_v2")
      throw new Error(
        `Isolated OpenCode database does not have the V2 schema: ${oldDatabase}`,
      );

    if (check) {
      console.log(`Preflight passed${pid ? `; old service PID ${pid}` : ""}.`);

      return;
    }

    if (!execute) {
      const logDirectory = join(stateRoot, "opencode-migration");
      const log = join(logDirectory, "default-paths.log");

      mkdirSync(logDirectory, { recursive: true });

      yield* commands.run("systemd-run", [
        "--user",
        "--collect",
        ...unitEnvironment,
        "--unit=dot-opencode-default-migration",
        "--on-active=30s",
        `--property=StandardOutput=append:${log}`,
        `--property=StandardError=append:${log}`,
        join(home, ".local", "bin", "dot"),
        "migrate",
        "opencode",
        "--execute",
      ]);
      console.log(
        `Migration scheduled. It may disconnect this session. Result log: ${log}`,
      );

      return;
    }

    if (pid) {
      console.log(`Stopping the inspected OpenCode service (PID ${pid}).`);
      yield* commands.run(binary, ["service", "stop"], {
        env: isolatedEnvironment,
      });
    }

    const waitForDatabase = commands
      .exitCode("fuser", ["-s", oldDatabase])
      .pipe(
        Effect.repeat({
          until: (code) => code === 1,
          schedule: Schedule.spaced("1 second").pipe(
            Schedule.upTo({ times: 30 }),
          ),
        }),
      );

    if ((yield* waitForDatabase) !== 1)
      throw new Error(
        "The old OpenCode database is still open. No data was moved.",
      );

    // The server can respawn between checks. Stop before touching either database.
    if (inspectedServicePid(binary))
      throw new Error(
        "The isolated OpenCode service restarted. No data was moved.",
      );

    console.log("Moving OpenCode data and preserving the old history.");
    renameSync(data, archive);
    renameSync(previousData, data);
    rmSync(join(data, "auth.json"));
    copyFileSync(join(archive, "auth.json"), join(data, "auth.json"));
    chmodSync(
      join(data, "auth.json"),
      statSync(join(archive, "auth.json")).mode,
    );
    archiveAndMove(
      state,
      previousState,
      join(stateRoot, "opencode-v1-archive"),
    );
    archiveAndMove(
      cache,
      previousCache,
      join(cacheRoot, "opencode-v1-archive"),
    );

    // The moved registration still names the stopped isolated service.
    rmSync(join(state, "service.json"), { force: true });

    if (existsSync(oldConfig)) renameSync(oldConfig, join(archive, "cli.json"));

    if (existsSync(oldEnvironment))
      renameSync(oldEnvironment, join(archive, ".env"));

    const migrated = yield* commands.run("sqlite3", [
      "-readonly",
      join(data, "opencode.db"),
      "SELECT name FROM sqlite_master WHERE name='session_v2'",
    ]);

    if (migrated.trim() !== "session_v2")
      throw new Error(
        "The OpenCode 2 database did not arrive at the default path",
      );

    const staleDatabase = join(
      dataRoot,
      "opencode-v2",
      "opencode",
      "opencode.db",
    );

    const restarted = inspectedServicePid(binary);

    if (restarted) {
      console.log(
        `Stopping the restarted isolated service (PID ${restarted}).`,
      );
      yield* commands.run(binary, ["service", "stop"], {
        env: isolatedEnvironment,
      });
    }

    if (existsSync(staleDatabase)) {
      const sessions = yield* commands.run("sqlite3", [
        "-readonly",
        staleDatabase,
        "SELECT count(*) FROM session_v2",
      ]);

      if (sessions.trim() !== "0")
        throw new Error(
          "A restarted isolated service has sessions; keeping its data for review",
        );

      if ((yield* commands.exitCode("fuser", ["-s", staleDatabase])) !== 1)
        throw new Error(
          "The restarted isolated service still has its database open",
        );
    }

    if (inspectedServicePid(binary))
      throw new Error(
        "The isolated service restarted again; keeping its runtime directories for review",
      );

    console.log("Removing retired isolated runtime directories.");

    for (const path of [
      join(dataRoot, "opencode-v2"),
      join(stateRoot, "opencode-v2"),
      join(cacheRoot, "opencode-v2"),
      join(configRoot, "opencode-v2"),
    ]) {
      rmSync(path, { recursive: true, force: true });
    }

    const wrapper = join(home, ".local", "bin", "opencode2");
    const paths = yield* commands.run(wrapper, ["debug", "paths"]);

    if (!paths.includes(`db         ${join(data, "opencode.db")}`))
      throw new Error("The OpenCode launcher still uses the old database path");

    console.log("Starting OpenCode at the default paths.");
    yield* commands.run("systemd-run", [
      "--user",
      "--collect",
      ...unitEnvironment,
      "--unit=dot-opencode-default-service",
      wrapper,
      "serve",
      "--service",
    ]);

    const current = yield* commands.run(wrapper, ["service", "status"]).pipe(
      Effect.repeat({
        until: (status) => status.trim().startsWith("http"),
        schedule: Schedule.spaced("1 second").pipe(
          Schedule.upTo({ times: 30 }),
        ),
      }),
    );

    if (
      !current.trim().startsWith("http") ||
      !existsSync(join(state, "service.json"))
    )
      throw new Error("The default-path OpenCode service is not running");

    const ctxSource = join(archive, "opencode.db");

    const ctx = yield* commands.exitCode("ctx", [
      "sources",
      "add",
      "--provider",
      "opencode",
      "--root",
      ctxSource,
      "v1-archive",
    ]);

    if (ctx !== 0)
      console.warn(
        "ctx could not register the archived history. Add it manually later.",
      );

    console.log(
      "Migration complete. Run dot doctor to check for other leftovers.",
    );
  });
