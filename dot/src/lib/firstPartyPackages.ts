/**
 * @file First-party packages: upgrade the packages installed from the signed
 * [timmo] repository without a password, through a root-owned unit the user
 * may start through polkit, then restart what's still running a replaced
 * binary. The packages' own install scripts restart their user services, so
 * only what they leave on an old binary is restarted here, never twice.
 */

import { Clock, Effect, FileSystem, Schema } from "effect";
import { userInfo } from "os";
import { basename, join } from "path";
import { lines, query } from "./boundedQuery.js";
import { runElevated } from "./elevatedCommand.js";
import { notable, skip, warn, type RecapEntry } from "./updateSummary.js";
import { publicPacmanRepoConfigPath } from "../commands/SetupPublicRepo.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";

/** The repository whose packages this upgrades. */
const REPOSITORY = "timmo";

/** The installed template unit, one instance per user. */
const ROOT_UNIT = "/etc/systemd/system/dot-first-party-upgrade@.service";

/** The pacman config the unit runs with, listing only [timmo]. */
const ROOT_PACMAN_CONFIG = "/etc/dot/first-party/pacman.conf";

/** The polkit rule that lets a user start their own instance. */
const ROOT_POLKIT_RULE =
  "/etc/polkit-1/rules.d/50-dot-first-party-upgrade.rules";

/**
 * A copy of the installed rule the user can read, since polkit's rules
 * directory is only readable by root and polkitd.
 */
const ROOT_POLKIT_RULE_COPY =
  "/etc/dot/first-party/50-dot-first-party-upgrade.rules";

/** Seconds a quick pacman, systemctl or journalctl query may take. */
const QUERY_TIMEOUT = 30;

/** Where pacman marks an executable replaced since a process started it. */
const DELETED = " (deleted)";

/** The unit, pacman config and polkit rule in the public dotfiles. */
export const firstPartySources = (publicDotfiles: string) => {
  const directory = join(publicDotfiles, "first-party");

  return {
    unit: join(directory, "dot-first-party-upgrade@.service"),
    pacmanConfig: join(directory, "pacman.conf"),
    polkitRule: join(directory, "50-dot-first-party-upgrade.rules"),
  };
};

/** The unit instance for the user running dot. */
export const firstPartyUnit = () =>
  `dot-first-party-upgrade@${userInfo().username}.service`;

/** A first-party upgrade that didn't finish. */
export class FirstPartyUpgradeError extends Schema.TaggedError<FirstPartyUpgradeError>()(
  "FirstPartyUpgradeError",
  { message: Schema.String },
) {}

/** Whether the root-owned unit, pacman config and polkit rule match the dotfiles. */
export const firstPartyRootCurrent = Effect.fn(
  "FirstPartyPackages.rootCurrent",
)(function* () {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* Config;
  const sources = firstPartySources(config.publicDotfiles);

  const same = (source: string, installed: string) =>
    Effect.all([fs.readFileString(source), fs.readFileString(installed)]).pipe(
      Effect.map(([left, right]) => left === right),
      Effect.orElseSucceed(() => false),
    );

  return (
    (yield* same(sources.unit, ROOT_UNIT)) &&
    (yield* same(sources.pacmanConfig, ROOT_PACMAN_CONFIG)) &&
    (yield* same(sources.polkitRule, ROOT_POLKIT_RULE_COPY))
  );
});

/**
 * Install the unit, its pacman config and the polkit rule root-owned when
 * they differ from the dotfiles, so neither runs files the user can write.
 * Returns whether the copy changed, or null when the install failed.
 */
export const syncRootFirstParty = Effect.fn("FirstPartyPackages.syncRoot")(
  function* () {
    const config = yield* Config;
    const sources = firstPartySources(config.publicDotfiles);

    if (yield* firstPartyRootCurrent()) return false;

    const exitCode = yield* runElevated("sh", [
      "-c",
      `set -e
install -Dm644 "$1" ${ROOT_UNIT}
install -Dm644 "$2" ${ROOT_PACMAN_CONFIG}
install -Dm644 "$3" ${ROOT_POLKIT_RULE}
install -Dm644 "$3" ${ROOT_POLKIT_RULE_COPY}
systemctl daemon-reload`,
      "sh",
      sources.unit,
      sources.pacmanConfig,
      sources.polkitRule,
    ]);

    return exitCode === 0 ? true : null;
  },
);

/** Installed package versions by name, from `pacman -Q`. */
const installedVersions = Effect.gen(function* () {
  const result = yield* query("pacman", ["-Q"], QUERY_TIMEOUT);

  return new Map(
    lines(result.stdout).flatMap((line) => {
      const [name, version] = line.split(/\s+/);

      return name && version ? [[name, version] as const] : [];
    }),
  );
}).pipe(Effect.withSpan("FirstPartyPackages.installedVersions"));

/** The packages installed from [timmo], from its sync database. */
const repositoryPackages = Effect.gen(function* () {
  const result = yield* query("pacman", ["-Sl", REPOSITORY], QUERY_TIMEOUT);

  return lines(result.stdout).flatMap((line) => {
    const [, name] = line.split(/\s+/);

    return name && line.includes("[installed") ? [name] : [];
  });
}).pipe(Effect.withSpan("FirstPartyPackages.repositoryPackages"));

/** The user unit a process runs in, from its cgroup, or null outside one. */
const userUnitOf = Effect.fn("FirstPartyPackages.userUnitOf")(function* (
  pid: string,
) {
  const fs = yield* FileSystem.FileSystem;

  const cgroup = yield* fs
    .readFileString(`/proc/${pid}/cgroup`)
    .pipe(Effect.orElseSucceed(() => ""));

  return (
    /\/user@\d+\.service\/(?:[^/\n]+\.slice\/)*([^/\n]+\.service)$/m.exec(
      cgroup,
    )?.[1] ?? null
  );
});

/** A process still running an executable an upgrade replaced. */
interface StaleProcess {
  readonly pid: string;
  /** The replaced executable's path. */
  readonly binary: string;
  /** The user unit it runs in, or null outside one. */
  readonly unit: string | null;
}

/** This user's processes still running one of `binaries` from before it was replaced. */
const staleProcesses = Effect.fn("FirstPartyPackages.staleProcesses")(
  function* (binaries: ReadonlySet<string>) {
    const fs = yield* FileSystem.FileSystem;

    const pids = (yield* fs
      .readDirectory("/proc")
      .pipe(Effect.orElseSucceed((): string[] => []))).filter((name) =>
      /^\d+$/.test(name),
    );

    const found = yield* Effect.forEach(
      pids,
      (pid) =>
        Effect.gen(function* () {
          // Other users' processes can't be read, which leaves them out
          const exe = yield* fs
            .readLink(`/proc/${pid}/exe`)
            .pipe(Effect.orElseSucceed(() => ""));

          if (!exe.endsWith(DELETED)) return [];

          const binary = exe.slice(0, -DELETED.length);

          if (!binaries.has(binary)) return [];

          return [
            {
              pid,
              binary,
              unit: yield* userUnitOf(pid),
            } satisfies StaleProcess,
          ];
        }),
      { concurrency: 16 },
    );

    return found.flat();
  },
);

/** A user unit's main process, or null when it has none or can't be read. */
const mainPidOf = Effect.fn("FirstPartyPackages.mainPidOf")(function* (
  unit: string,
) {
  const result = yield* query(
    "systemctl",
    ["--user", "show", "--property=MainPID", "--value", unit],
    QUERY_TIMEOUT,
  );

  const pid = result.stdout.trim();

  return result.code === 0 && pid !== "" && pid !== "0" ? pid : null;
});

/**
 * Restart the user units whose main process still runs an executable of
 * `packages` from before the upgrade replaced it. Only a unit's main process
 * counts: a stale child, such as a client the desktop shell started inside
 * the compositor's unit, would otherwise restart the whole session. The unit
 * this stage runs in, such as the Upkeep worker, is left for whatever
 * restarts it, since restarting it would stop this run. Every other stale
 * process is only reported, and only for `upgraded`, so it isn't reported on
 * every run after.
 */
const restartStale = Effect.fn("FirstPartyPackages.restartStale")(function* (
  packages: readonly string[],
  upgraded: ReadonlySet<string>,
) {
  const executor = yield* CommandExecutor;

  if (packages.length === 0) return [];

  const files = yield* query("pacman", ["-Ql", ...packages], QUERY_TIMEOUT);

  const owners = new Map(
    lines(files.stdout).flatMap((line) => {
      const [name, path] = line.split(/\s+/, 2);

      return name && path && !path.endsWith("/") ? [[path, name] as const] : [];
    }),
  );

  const stale = yield* staleProcesses(new Set(owners.keys()));
  const own = yield* userUnitOf(String(process.pid));
  const actions: RecapEntry[] = [];

  const candidates = [
    ...new Set(stale.flatMap(({ unit }) => (unit === null ? [] : [unit]))),
  ];

  const mains = new Map(
    yield* Effect.forEach(candidates, (unit) =>
      mainPidOf(unit).pipe(Effect.map((pid) => [unit, pid] as const)),
    ),
  );

  const isMain = ({ unit, pid }: StaleProcess) =>
    unit !== null && mains.get(unit) === pid;

  const units = new Map(
    stale.flatMap((found) =>
      found.unit !== null && isMain(found)
        ? [[found.unit, found.binary] as const]
        : [],
    ),
  );

  for (const [unit, binary] of units) {
    if (unit === own) {
      actions.push(
        warn(
          `${unit} runs this stage, so it picks up the new ${basename(binary)} once it restarts`,
        ),
      );
      continue;
    }

    const exitCode = yield* executor.exitCode("systemctl", [
      "--user",
      "try-restart",
      unit,
    ]);

    actions.push(
      exitCode === 0
        ? notable(
            `Restarted ${unit}, which was running the old ${basename(binary)}`,
          )
        : warn(`Could not restart ${unit} (exit ${exitCode})`),
    );
  }

  const loose = new Map(
    stale.flatMap((found) => {
      const owner = owners.get(found.binary);

      return !isMain(found) && owner !== undefined && upgraded.has(owner)
        ? [[found.binary, found.pid] as const]
        : [];
    }),
  );

  for (const [binary, pid] of loose)
    actions.push(
      warn(
        `${basename(binary)} (pid ${pid}) is still running the old version; restart it to pick up the new one`,
      ),
    );

  return actions;
});

/**
 * Log the upgrade's own output from the system journal since it started,
 * best effort. A oneshot unit forgets its invocation once it succeeds, so
 * this reads by unit and time rather than invocation.
 */
const logInvocation = Effect.fn("FirstPartyPackages.logInvocation")(function* (
  unit: string,
  startedAt: number,
) {
  const log = yield* OutputLog;

  const journal = yield* query(
    "journalctl",
    [
      `--unit=${unit}`,
      `--since=@${Math.floor(startedAt / 1000)}`,
      "--output=cat",
      "--no-pager",
      "--quiet",
    ],
    QUERY_TIMEOUT,
  );

  for (const line of lines(journal.stdout)) yield* log.info(line);
});

/**
 * Upgrade the packages installed from [timmo] through the root unit, then
 * restart what's still on a replaced binary. Without the unit and rule set
 * up, or without [timmo] registered, it does nothing and says how to set it
 * up.
 */
export const upgradeFirstParty = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  const ready = yield* Effect.all([
    fs.exists(ROOT_UNIT),
    fs.exists(ROOT_POLKIT_RULE_COPY),
  ]).pipe(Effect.orElseSucceed(() => [false, false]));

  if (!ready.every(Boolean))
    return [
      warn(
        "First-party upgrades aren't set up here: tick System in dot up, or run dot init",
      ),
    ];

  if (
    !(yield* fs
      .exists(publicPacmanRepoConfigPath())
      .pipe(Effect.orElseSucceed(() => false)))
  )
    return [skip("The [timmo] repository isn't registered here")];

  const unit = firstPartyUnit();
  const before = yield* installedVersions;

  yield* log.info(`Starting ${unit}`);

  const startedAt = yield* Clock.currentTimeMillis;

  const exitCode = yield* executor.exitCode("systemctl", [
    "start",
    "--no-ask-password",
    unit,
  ]);

  yield* logInvocation(unit, startedAt);

  if (exitCode !== 0)
    return yield* new FirstPartyUpgradeError({
      message: `${unit} failed (exit ${exitCode}); see journalctl -u ${unit}`,
    });

  const after = yield* installedVersions;
  const packages = yield* repositoryPackages;

  const upgraded = packages.flatMap((name) => {
    const from = before.get(name);
    const to = after.get(name);

    return from !== undefined && to !== undefined && from !== to
      ? [{ name, from, to }]
      : [];
  });

  const actions: RecapEntry[] =
    upgraded.length > 0
      ? upgraded.map(({ name, from, to }) =>
          notable(`Upgraded ${name} ${from} -> ${to}`),
        )
      : [skip("First-party packages already up to date")];

  actions.push(
    ...(yield* restartStale(
      packages,
      new Set(upgraded.map(({ name }) => name)),
    )),
  );

  return actions;
}).pipe(Effect.withSpan("FirstPartyPackages.upgrade"));
