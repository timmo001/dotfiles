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
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { join } from "path";
import { CACHE_DIR } from "../lib/paths.js";
import { SKILLS_CHECKOUT } from "../lib/skillsMaintenance.js";
import { Config } from "../services/Config.js";

const BarStatus = Schema.Struct({
  text: Schema.String,
  tooltip: Schema.String,
  class: Schema.Literals(["updates", "updates-current", "updates-unknown"]),
});

type BarStatus = typeof BarStatus.Type;

const DotState = Schema.Literals(["current", "available", "unknown"]);

const SkillsStatus = Schema.Struct({
  behind: Schema.Int,
  changed: Schema.Array(Schema.String),
});

type SkillsStatus = typeof SkillsStatus.Type;

const CachedStatus = Schema.Struct({
  ...BarStatus.fields,
  footerText: Schema.optional(Schema.String),
  packageStatus: Schema.optional(BarStatus),
  packagesCheckedAt: Schema.optional(Schema.Finite),
  dot: Schema.optional(DotState),
  dotPending: Schema.optional(Schema.Array(Schema.String)),
  skills: Schema.optional(Schema.NullOr(SkillsStatus)),
  checkedAt: Schema.optional(Schema.Finite),
});

const decodeStatus = Schema.decodeUnknownOption(
  Schema.fromJsonString(CachedStatus),
);

const decodeBackoff = Schema.decodeUnknownOption(
  Schema.Tuple([Schema.Int, Schema.Int]),
);

const AUR_HTTP_FAILURE_PATTERNS = [
  /\bstatus\b[^0-9]*\b[45][0-9]{2}\b/i,
  /\bhttp(?:\/\d+(?:\.\d+)?)?\b[^0-9]*\b[45][0-9]{2}\b/i,
] as const;

const current: BarStatus = {
  text: "\uF487 0",
  tooltip: "Watched packages are up to date",
  class: "updates-current",
};

const unavailable: BarStatus = {
  text: "\uF487 ?",
  tooltip: "Watched package updates unavailable",
  class: "updates-unknown",
};

const loading: BarStatus = {
  text: "\uF487 ..",
  tooltip: "Dotfiles update status: loading\nWatched package updates: loading",
  class: "updates-unknown",
};

const DOT_ICON = "\uF4B5";

const SKILLS_ICON = "\uF404";

/** Paths and timing controls for update refreshes. */
export interface UpdatesOptions {
  /** Watched package list; defaults to the public dotfiles package manifest. */
  readonly packageFile?: string;
  /** Status cache directory; defaults to the XDG status-bar cache. */
  readonly cacheDir?: string;
  /** Maximum duration of each external check, in seconds. */
  readonly timeout: number;
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
        AUR_HTTP_FAILURE_PATTERNS.some((pattern) =>
          pattern.test(aurResult.stderr),
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
    text: `\uF487 ${updates.length}`,
    tooltip: `Watched package updates:\n${updates.join("\n")}${aurAvailable ? "" : "\n\nAUR updates unavailable"}`,
    class: "updates",
  } satisfies BarStatus;
});

const skillNames = (listing: string) =>
  new Set(
    listing
      .split("\n")
      .flatMap((path) => /^([^/]+)\/SKILL\.md$/.exec(path.trim())?.[1] ?? []),
  );

/** Compare the managed skills checkout with the latest `main`, without moving it. */
const skills = Effect.fn("Updates.skills")(function* (options: UpdatesOptions) {
  const git = (args: readonly string[]) =>
    query("git", ["-C", SKILLS_CHECKOUT, ...args], options.timeout);

  if ((yield* git(["fetch", "--quiet", "origin", "main"])).code !== 0)
    return null;

  const count = yield* git(["rev-list", "--count", "HEAD..origin/main"]);
  const behind = Number(count.stdout.trim());

  if (count.code !== 0 || !Number.isInteger(behind)) return null;

  if (behind === 0) return { behind, changed: [] } satisfies SkillsStatus;

  const [diff, current, latest] = yield* Effect.all([
    git(["diff", "--name-only", "HEAD", "origin/main"]),
    git(["ls-tree", "-r", "--name-only", "HEAD"]),
    git(["ls-tree", "-r", "--name-only", "origin/main"]),
  ]);

  const known = new Set([
    ...skillNames(current.stdout),
    ...skillNames(latest.stdout),
  ]);

  const changed = [
    ...new Set(
      diff.stdout.split("\n").flatMap((path) => {
        const name = path.trim().split("/", 1)[0];

        return name && known.has(name) ? [name] : [];
      }),
    ),
  ].sort();

  return { behind, changed } satisfies SkillsStatus;
});

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** Read the items `dot update --check` lists under its "N pending updates:" heading. */
const pendingItems = (output: string) => {
  const lines = output.split("\n").map((line) => line.trim());
  const start = lines.findIndex((line) => /^\d+ pending updates:$/.test(line));

  if (start === -1) return [];

  const items = lines.slice(start + 1);

  const end = items.findIndex(
    (line) => line === "" || line.startsWith("Run `dot update`"),
  );

  return end === -1 ? items : items.slice(0, end);
};

const skillsMessage = (status: SkillsStatus | null) => {
  if (status === null) return "Skills update status unavailable";

  if (status.behind === 0) return "Skills are up to date";

  const names =
    status.changed.length > 0 ? `: ${status.changed.join(", ")}` : "";

  return `Skills are ${plural(status.behind, "commit")} behind${names}`;
};

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

        const skillsStatus = yield* skills(options);

        const dot = Match.value(dotResult.code).pipe(
          Match.when(0, () => "current" as const),
          Match.when(10, () => "available" as const),
          Match.orElse(() => "unknown" as const),
        );

        const dotPending =
          dot === "available" ? pendingItems(dotResult.stdout) : [];

        const message = {
          current: "Dotfiles are up to date",
          available: `Dotfiles updates available${dotPending.length > 0 ? `: ${dotPending.join(", ")}` : ""}`,
          unknown: "Dotfiles update status unavailable",
        }[dot];

        const dotPart = `${DOT_ICON} ${
          {
            current: 0,
            available: Math.max(1, dotPending.length),
            unknown: "?",
          }[dot]
        }`;

        const skillsPart = `${SKILLS_ICON} ${skillsStatus?.behind ?? "?"}`;
        const skillsBehind = (skillsStatus?.behind ?? 0) > 0;

        const attention = [
          ...(dot === "current" ? [] : [dotPart]),
          ...(skillsStatus === null || skillsBehind ? [skillsPart] : []),
          ...(packageStatus.class === "updates-current"
            ? []
            : [packageStatus.text]),
        ];

        const status: BarStatus = {
          text: attention.length > 0 ? attention.join("  ") : DOT_ICON,
          tooltip: `${message}\n${skillsMessage(skillsStatus)}\n\n${packageStatus.tooltip}`,
          class:
            dot === "available" || skillsBehind
              ? "updates"
              : (dot === "unknown" || skillsStatus === null) &&
                  packageStatus.class === "updates-current"
                ? "updates-unknown"
                : packageStatus.class,
        };

        yield* fs.writeFileString(
          `${locations.cache}.tmp`,
          `${JSON.stringify({
            ...status,
            footerText: [dotPart, skillsPart, packageStatus.text].join("  "),
            packageStatus,
            packagesCheckedAt,
            dot,
            dotPending,
            skills: skillsStatus,
            checkedAt: yield* Clock.currentTimeMillis,
          })}\n`,
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
  json = false,
) {
  const fs = yield* FileSystem.FileSystem;
  const locations = yield* paths({ timeout: 120 });
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
        900 * 1000) &&
    !(yield* fs.exists(locations.lock))
  ) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const spawnRefresh = spawner
      .spawn(
        ChildProcess.make(
          "dot",
          [
            "updates",
            "refresh",
            "--scheduled",
            "--package-file",
            locations.packageFile,
            "--cache-dir",
            locations.directory,
            "--timeout",
            "120",
          ],
          {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            detached: true,
          },
        ),
      )
      .pipe(
        Effect.flatMap((child) => child.unref),
        Effect.asVoid,
        Effect.scoped,
      );

    yield* spawnRefresh;
  }

  const {
    text,
    tooltip,
    class: statusClass,
  } = Option.getOrElse(status, () => loading);

  const bar = { text, tooltip, class: statusClass };

  if (json) {
    const cachedStatus = Option.getOrUndefined(status);

    yield* Console.log(
      JSON.stringify({
        checkedAt: cachedStatus?.checkedAt ?? null,
        dot: cachedStatus?.dot ?? null,
        dotPending: cachedStatus?.dotPending ?? [],
        skills: cachedStatus?.skills ?? null,
        packages: cachedStatus?.packageStatus ?? null,
        bar,
        footer: { ...bar, text: cachedStatus?.footerText ?? text },
      }),
    );

    return;
  }

  yield* Console.log(JSON.stringify(bar));
});
