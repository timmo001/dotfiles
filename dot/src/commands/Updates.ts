import { Clock, Console, Effect, FileSystem, Option, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { join } from "path";
import { CACHE_DIR } from "../lib/paths.js";
import {
  checkAll,
  dotfiles,
  ghExtensions,
  groupLines,
  hasWork,
  pendingGroups,
  PendingStatus,
  query,
  skills,
  tools,
} from "../lib/pendingUpdates.js";

const BarStatus = Schema.Struct({
  text: Schema.String,
  tooltip: Schema.String,
  class: Schema.Literals([
    "updates",
    "updates-missing",
    "updates-current",
    "updates-unknown",
  ]),
});

type BarStatus = typeof BarStatus.Type;

const CachedStatus = Schema.Struct({
  ...BarStatus.fields,
  footerText: Schema.String,
  status: PendingStatus,
  packagesCheckedAt: Schema.Finite,
  checkedAt: Schema.Finite,
});

const decodeStatus = Schema.decodeUnknownOption(
  Schema.fromJsonString(CachedStatus),
);

const loading: BarStatus = {
  text: "\uF4B5 ..",
  tooltip: "Checking for updates",
  class: "updates-unknown",
};

const DOT_ICON = "\uF4B5";

/** Paths and timing controls for update refreshes. */
export interface UpdatesOptions {
  /** Status cache directory; defaults to the XDG status-bar cache. */
  readonly cacheDir?: string;
  /** Maximum duration of each external check, in seconds. */
  readonly timeout: number;
}

const paths = (options: Pick<UpdatesOptions, "cacheDir">) => {
  const directory = options.cacheDir ?? join(CACHE_DIR, "status-bar");

  return {
    directory,
    cache: join(directory, "package-updates.json"),
    lock: join(directory, "package-updates.lock"),
    backoff: join(directory, "package-updates.backoff"),
  };
};

/** Compose the bar, tooltip and footer text from a status. */
const render = (status: PendingStatus) => {
  const groups = pendingGroups(status);

  const attention = groups.flatMap((group) => {
    const count = group.pending.length + group.missing.length;
    const blocked = group.blocked.length > 0 ? "!" : "";

    if (count > 0 || blocked) return [`${group.icon} ${count}${blocked}`];

    return group.unknown ? [`${group.icon} ?`] : [];
  });

  const tooltip = groups
    .map((group) => {
      if (hasWork(group) || group.blocked.length > 0) {
        return [
          `${group.title}:`,
          ...groupLines(group).map((line) => `  ${line}`),
        ].join("\n");
      }

      return `${group.title}: ${group.unknown ? "unavailable" : "up to date"}`;
    })
    .join("\n");

  const working = groups.some(hasWork);

  const bar: BarStatus = {
    text: attention.length > 0 ? attention.join("  ") : DOT_ICON,
    tooltip: working ? `${tooltip}\n\nClick to run dot up` : tooltip,
    class: groups.some(
      (group) => group.missing.length > 0 || group.blocked.length > 0,
    )
      ? "updates-missing"
      : working
        ? "updates"
        : groups.some((group) => group.unknown)
          ? "updates-unknown"
          : "updates-current",
  };

  return {
    bar,
    footerText: attention.length > 0 ? attention.join("  ") : `${DOT_ICON} 0`,
  };
};

/**
 * Refresh the update status and notify the shell. `quick` keeps the cached
 * package and Omarchy status, for the end of `dot update`; scheduled runs
 * respect the AUR request backoff.
 */
export const updatesRefresh = Effect.fn("Updates.refresh")(function* (
  options: UpdatesOptions,
  scheduled = false,
  quick = false,
) {
  const fs = yield* FileSystem.FileSystem;
  const locations = paths(options);
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

        const previous = quick
          ? yield* fs.readFileString(locations.cache).pipe(
              Effect.map(decodeStatus),
              Effect.orElseSucceed(() => Option.none()),
              Effect.map(Option.getOrUndefined),
            )
          : undefined;

        const backoff = { file: locations.backoff, respect: scheduled };

        const status: PendingStatus = previous
          ? {
              ...previous.status,
              ...(yield* Effect.all(
                {
                  dot: dotfiles(options.timeout),
                  skills: skills(options.timeout),
                  tools: tools(options.timeout),
                  gh: ghExtensions(),
                },
                { concurrency: "unbounded" },
              )),
            }
          : yield* checkAll(options.timeout, backoff);

        const now = yield* Clock.currentTimeMillis;

        yield* writeStatus(
          locations.cache,
          status,
          previous?.packagesCheckedAt ?? now,
        );
      }),
    (acquired) =>
      acquired
        ? fs.remove(locations.lock, { recursive: true }).pipe(Effect.orDie)
        : Effect.void,
  );
});

const writeStatus = Effect.fn("Updates.write")(function* (
  cache: string,
  status: PendingStatus,
  packagesCheckedAt: number,
) {
  const fs = yield* FileSystem.FileSystem;
  const now = yield* Clock.currentTimeMillis;
  const { bar, footerText } = render(status);
  const temporary = `${cache}.${process.pid}.tmp`;

  yield* fs.writeFileString(
    temporary,
    `${JSON.stringify({
      ...bar,
      footerText,
      status,
      packagesCheckedAt,
      checkedAt: now,
    } satisfies typeof CachedStatus.Type)}\n`,
    { mode: 0o600 },
  );
  yield* fs.rename(temporary, cache);
  yield* query("omarchy-shell", ["-q", "timmo.updates", "refresh"], 5);
});

/** Save a fresh full check as the cached status, as `dot up` does after checking. */
export const saveStatus = Effect.fn("Updates.save")(function* (
  status: PendingStatus,
) {
  const fs = yield* FileSystem.FileSystem;
  const locations = paths({});
  const now = yield* Clock.currentTimeMillis;

  yield* fs.makeDirectory(locations.directory, { recursive: true });
  yield* writeStatus(locations.cache, status, now);
});

/** Print cached status immediately and start a detached refresh when it is stale. */
export const updatesStatus = Effect.fn("Updates.status")(function* (
  json = false,
) {
  const fs = yield* FileSystem.FileSystem;
  const locations = paths({});
  const now = yield* Clock.currentTimeMillis;
  const cached = yield* fs.readFileString(locations.cache).pipe(Effect.option);
  const status = Option.flatMap(cached, decodeStatus);

  if (
    (Option.isNone(status) ||
      now - status.value.packagesCheckedAt >= 900 * 1000) &&
    !(yield* fs.exists(locations.lock))
  ) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    yield* spawner
      .spawn(
        ChildProcess.make(
          "dot",
          [
            "updates",
            "refresh",
            "--scheduled",
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
  }

  const current = Option.getOrUndefined(status);

  const bar: BarStatus = current
    ? { text: current.text, tooltip: current.tooltip, class: current.class }
    : loading;

  if (json) {
    yield* Console.log(
      JSON.stringify({
        checkedAt: current?.checkedAt ?? null,
        status: current?.status ?? null,
        groups: current ? pendingGroups(current.status) : [],
        skills: current?.status.skills ?? null,
        bar,
        footer: { ...bar, text: current?.footerText ?? bar.text },
      }),
    );

    return;
  }

  yield* Console.log(JSON.stringify(bar));
});
