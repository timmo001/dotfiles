import {
  Clock,
  Console,
  Effect,
  FileSystem,
  Match,
  Option,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { join } from "path";
import { CACHE_DIR } from "../lib/paths.js";
import { Config } from "../services/Config.js";

const BarStatus = Schema.Struct({
  text: Schema.String,
  tooltip: Schema.String,
  class: Schema.Literals(["updates", "updates-current", "updates-unknown"]),
});

type BarStatus = typeof BarStatus.Type;

const CachedStatus = Schema.Struct({
  ...BarStatus.fields,
  packageStatus: Schema.optional(BarStatus),
  packagesCheckedAt: Schema.optional(Schema.Number),
});

const decodeStatus = Schema.decodeUnknownOption(
  Schema.fromJsonString(CachedStatus),
);

const decodeBackoff = Schema.decodeUnknownOption(
  Schema.Tuple([Schema.Int, Schema.Int]),
);

const current: BarStatus = {
  text: "󰏕 0",
  tooltip: "Watched packages are up to date",
  class: "updates-current",
};

const unavailable: BarStatus = {
  text: " ?",
  tooltip: "Watched package updates unavailable",
  class: "updates-unknown",
};

const loading: BarStatus = {
  text: "󰏕 ..",
  tooltip: "Dotfiles update status: loading\nWatched package updates: loading",
  class: "updates-unknown",
};

/** Paths and timing controls shared by update status and refresh commands. */
export interface UpdatesOptions {
  /** Watched package list; defaults to the public dotfiles package manifest. */
  readonly packageFile?: string;
  /** Status cache directory; defaults to the XDG status-bar cache. */
  readonly cacheDir?: string;
  /** Maximum duration of each external check, in seconds. */
  readonly timeout: number;
  /** Age at which status starts a background refresh, in seconds. */
  readonly cacheMaxAge?: number;
}

const paths = Effect.fn("Updates.paths")(function* (options: UpdatesOptions) {
  const config = yield* Config;
  const directory = options.cacheDir ?? join(CACHE_DIR, "status-bar");

  return {
    directory,
    packageFile:
      options.packageFile ??
      join(config.publicDotfiles, ".dot-public-packages"),
    cache: join(directory, "package-updates.json"),
    lock: join(directory, "package-updates.lock"),
    backoff: join(directory, "package-updates.backoff"),
  };
});

const query = Effect.fn("Updates.query")(
  function* (command: string, args: readonly string[], _timeout: number) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const child = yield* spawner.spawn(
      ChildProcess.make(command, args, { stdin: "ignore" }),
    );

    return yield* Effect.all(
      {
        code: child.exitCode,
        stdout: child.stdout.pipe(Stream.decodeText(), Stream.mkString),
        stderr: child.stderr.pipe(Stream.decodeText(), Stream.mkString),
      },
      { concurrency: "unbounded" },
    );
  },
  Effect.scoped,
  (effect, _command, _args, timeout) =>
    effect.pipe(
      Effect.timeout(`${timeout} seconds`),
      Effect.catch((error) =>
        Effect.succeed({ code: -1, stdout: "", stderr: String(error) }),
      ),
    ),
);

const packages = Effect.fn("Updates.packages")(function* (
  options: UpdatesOptions,
  locations: Effect.Success<ReturnType<typeof paths>>,
  scheduled: boolean,
) {
  const fs = yield* FileSystem.FileSystem;

  const manifest = yield* fs
    .readFileString(locations.packageFile)
    .pipe(Effect.option);

  if (Option.isNone(manifest)) return unavailable;

  const watched = manifest.value.split("\n").flatMap((line) => {
    const name = line.trim().split(/\s+/, 1)[0];

    return name && !name.startsWith("#") ? [name] : [];
  });

  const repoPackages: string[] = [];
  const aurPackages: string[] = [];

  for (const name of watched) {
    if (
      (yield* query("pacman", ["-Qnq", "--", name], options.timeout)).code === 0
    )
      repoPackages.push(name);
    else if (
      (yield* query("pacman", ["-Qmq", "--", name], options.timeout)).code === 0
    )
      aurPackages.push(name);
  }

  const repoResult =
    repoPackages.length > 0
      ? yield* query("pacman", ["-Quq", "--", ...repoPackages], options.timeout)
      : { code: 0, stdout: "", stderr: "" };

  let aurResult = { code: 0, stdout: "", stderr: "" };

  if (aurPackages.length > 0) {
    const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);

    const saved = yield* fs
      .readFileString(locations.backoff)
      .pipe(Effect.orElseSucceed(() => "0 0"));

    const [failures, until] = Option.getOrElse(
      decodeBackoff(saved.trim().split(/\s+/).map(Number)),
      () => [0, 0],
    );

    if (scheduled && now < until) {
      aurResult = { code: 75, stdout: "", stderr: "AUR updates backed off" };
    } else {
      aurResult = yield* query(
        "yay",
        ["-Quaq", "--", ...aurPackages],
        options.timeout,
      );

      if (
        (aurResult.code === 0 || aurResult.code === 1) &&
        aurResult.stderr.trim() === ""
      ) {
        yield* fs.remove(locations.backoff, { force: true });
      } else if (
        /(status|HTTP([^0-9]|\/[0-9.]*)*)[^0-9]*[45][0-9]{2}([^0-9]|$)/i.test(
          aurResult.stderr,
        )
      ) {
        const nextFailures = Math.min(5, Math.max(0, failures) + 1);
        const seconds = Math.min(21600, 1800 * 2 ** (nextFailures - 1));
        yield* fs.writeFileString(
          locations.backoff,
          `${nextFailures} ${now + seconds}\n`,
          { mode: 0o600 },
        );
      }
    }
  }

  const updates = [
    ...new Set(
      `${repoResult.stdout}\n${aurResult.stdout}`
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ].sort();

  const aurAvailable =
    (aurResult.code === 0 || aurResult.code === 1) &&
    aurResult.stderr.trim() === "";

  if (updates.length === 0) return aurAvailable ? current : unavailable;

  return {
    text: `󰏕 ${updates.length}`,
    tooltip: `Watched package updates:\n${updates.join("\n")}${aurAvailable ? "" : "\n\nAUR updates unavailable"}`,
    class: "updates",
  } satisfies BarStatus;
});

/** Refresh Dotfiles status and optionally packages, respecting scheduled AUR backoff. */
export const updatesRefresh = Effect.fn("Updates.refresh")(function* (
  options: UpdatesOptions,
  scheduled = false,
  dotOnly = false,
) {
  const fs = yield* FileSystem.FileSystem;
  const locations = yield* paths(options);
  yield* fs.makeDirectory(locations.directory, { recursive: true });
  yield* Effect.acquireUseRelease(
    fs.makeDirectory(locations.lock).pipe(
      Effect.as(true),
      Effect.catchReason("PlatformError", "AlreadyExists", () =>
        Effect.succeed(false),
      ),
    ),
    (acquired) =>
      Effect.gen(function* () {
        if (!acquired) return;

        const cached = dotOnly
          ? yield* fs.readFileString(locations.cache).pipe(
              Effect.map(decodeStatus),
              Effect.orElseSucceed(() => Option.none()),
            )
          : Option.none();

        const previous = Option.getOrUndefined(cached);

        const packageStatus = dotOnly
          ? (previous?.packageStatus ?? unavailable)
          : yield* packages(options, locations, scheduled);

        const packagesCheckedAt = dotOnly
          ? (previous?.packagesCheckedAt ?? 0)
          : yield* Clock.currentTimeMillis;

        const dotResult = yield* query(
          "dot",
          ["update", "--check"],
          options.timeout,
        );

        const message = Match.value(dotResult.code).pipe(
          Match.when(0, () => "Dotfiles are up to date"),
          Match.when(10, () => "Dotfiles updates available"),
          Match.orElse(() => "Dotfiles update status unavailable"),
        );

        const status: BarStatus = {
          ...packageStatus,
          tooltip: `${message}\n\n${packageStatus.tooltip}`,
          class:
            dotResult.code === 10
              ? "updates"
              : dotResult.code !== 0 &&
                  packageStatus.class === "updates-current"
                ? "updates-unknown"
                : packageStatus.class,
        };

        yield* fs.writeFileString(
          `${locations.cache}.tmp`,
          `${JSON.stringify({ ...status, packageStatus, packagesCheckedAt })}\n`,
          { mode: 0o600 },
        );
        yield* fs.rename(`${locations.cache}.tmp`, locations.cache);
        yield* query("omarchy-shell", ["-q", "timmo.updates", "refresh"], 5);
      }),
    (acquired) =>
      acquired
        ? fs.remove(locations.lock, { recursive: true }).pipe(Effect.orDie)
        : Effect.void,
  );
});

/** Print cached status immediately and start a detached refresh when it is stale. */
export const updatesStatus = Effect.fn("Updates.status")(function* (
  options: UpdatesOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const locations = yield* paths(options);
  const now = yield* Clock.currentTimeMillis;
  const cached = yield* fs.readFileString(locations.cache).pipe(Effect.option);
  const status = Option.flatMap(cached, decodeStatus);

  const modified = yield* fs.stat(locations.cache).pipe(
    Effect.map((info) =>
      Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
    ),
    Effect.orElseSucceed(() => 0),
  );

  if (
    (Option.isNone(status) ||
      now - (Option.getOrUndefined(status)?.packagesCheckedAt ?? modified) >=
        (options.cacheMaxAge ?? 900) * 1000) &&
    !(yield* fs.exists(locations.lock))
  ) {
    yield* Effect.try(() => {
      const child = Bun.spawn(
        [
          "dot",
          "updates",
          "refresh",
          "--scheduled",
          "--package-file",
          locations.packageFile,
          "--cache-dir",
          locations.directory,
          "--timeout",
          String(options.timeout),
        ],
        {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
          detached: true,
        },
      );

      child.unref();
    });
  }

  const {
    text,
    tooltip,
    class: statusClass,
  } = Option.getOrElse(status, () => loading);

  yield* Console.log(JSON.stringify({ text, tooltip, class: statusClass }));
});
