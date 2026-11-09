/**
 * @file The update status as the bar, the OpenCode footer and the dot daemon
 * share it: one check result with its rendered bar and footer text, saved to
 * the status-bar cache so a restart has something to show.
 */

import { Clock, Effect, FileSystem, Option, Schema } from "effect";
import { join } from "path";
import { CACHE_DIR } from "./paths.js";
import {
  agentPlugins,
  checkAll,
  dotfiles,
  ghExtensions,
  ghUpgrades,
  groupLines,
  hasWork,
  pendingGroups,
  PendingStatus,
  skills,
  tools,
} from "./pendingUpdates.js";

/** How long a full check stays fresh before a scheduled refresh runs. */
export const STALE_AFTER_MILLIS = 900 * 1000;

/** Status-bar JSON for the updates widget. */
export const BarStatus = Schema.Struct({
  text: Schema.String,
  tooltip: Schema.String,
  class: Schema.Literals([
    "updates",
    "updates-missing",
    "updates-current",
    "updates-unknown",
  ]),
});

/** Status-bar JSON for the updates widget. */
export type BarStatus = typeof BarStatus.Type;

/** A check result with its rendered output and when it ran. */
export const UpdatesSnapshot = Schema.Struct({
  ...BarStatus.fields,
  footerText: Schema.String,
  status: PendingStatus,
  /** When the package and Omarchy checks last ran, in epoch milliseconds. */
  packagesCheckedAt: Schema.Finite,
  /** When any check last ran, in epoch milliseconds. */
  checkedAt: Schema.Finite,
});

/** A check result with its rendered output and when it ran. */
export interface UpdatesSnapshot extends Schema.Schema.Type<
  typeof UpdatesSnapshot
> {}

const decodeSnapshot = Schema.decodeUnknownOption(
  Schema.fromJsonString(UpdatesSnapshot),
);

/** Shown before the first check has finished. */
export const loadingBar: BarStatus = {
  text: " ..",
  tooltip: "Checking for updates",
  class: "updates-unknown",
};

const DOT_ICON = "";

/** The cache, lock and AUR backoff files, under the status-bar cache by default. */
export const updatesPaths = (cacheDir?: string) => {
  const directory = cacheDir ?? join(CACHE_DIR, "status-bar");

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

/** Render a status into a snapshot taken now. */
export const snapshotOf = Effect.fn("UpdatesSnapshot.of")(function* (
  status: PendingStatus,
  packagesCheckedAt?: number,
) {
  const now = yield* Clock.currentTimeMillis;
  const { bar, footerText } = render(status);

  return {
    ...bar,
    footerText,
    status,
    packagesCheckedAt: packagesCheckedAt ?? now,
    checkedAt: now,
  } satisfies UpdatesSnapshot;
});

/** Read the cached snapshot, or none when it is missing or unreadable. */
export const readSnapshot = Effect.fn("UpdatesSnapshot.read")(function* (
  cache: string,
) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFileString(cache).pipe(
    Effect.map(decodeSnapshot),
    Effect.orElseSucceed(() => Option.none<UpdatesSnapshot>()),
  );
});

/** Write the snapshot to the cache atomically. */
export const writeSnapshot = Effect.fn("UpdatesSnapshot.write")(function* (
  cache: string,
  snapshot: UpdatesSnapshot,
) {
  const fs = yield* FileSystem.FileSystem;
  const temporary = `${cache}.${process.pid}.tmp`;

  yield* fs.makeDirectory(join(cache, ".."), { recursive: true });
  yield* fs.writeFileString(temporary, `${JSON.stringify(snapshot)}\n`, {
    mode: 0o600,
  });
  yield* fs.rename(temporary, cache);
});

/** How to run a refresh. */
export interface CheckOptions {
  /** Maximum duration of each external check, in seconds. */
  readonly timeout: number;
  /** AUR backoff file, honoured only when `scheduled`. */
  readonly backoffFile: string;
  /** Respect the AUR request backoff, as scheduled refreshes do. */
  readonly scheduled: boolean;
  /** Keep the package and Omarchy status of `previous` instead of checking them. */
  readonly quick: boolean;
}

/**
 * Run the checks and render a snapshot. A quick check keeps the package and
 * Omarchy status of `previous`, and its `packagesCheckedAt`; without a
 * previous snapshot it runs every check.
 */
export const checkSnapshot = Effect.fn("UpdatesSnapshot.check")(function* (
  options: CheckOptions,
  previous: Option.Option<UpdatesSnapshot>,
) {
  const kept = options.quick ? Option.getOrUndefined(previous) : undefined;

  if (kept) {
    const fresh = yield* Effect.all(
      {
        dot: dotfiles(options.timeout),
        skills: skills(options.timeout),
        tools: tools(options.timeout),
        plugins: agentPlugins(options.timeout),
        gh: ghExtensions(),
        ghUpgrades: ghUpgrades(options.timeout),
      },
      { concurrency: "unbounded" },
    );

    return yield* snapshotOf(
      { ...kept.status, ...fresh },
      kept.packagesCheckedAt,
    );
  }

  const status = yield* checkAll(options.timeout, {
    file: options.backoffFile,
    respect: options.scheduled,
  });

  return yield* snapshotOf(status);
});

/** The bar output for a snapshot, or the loading state before the first check. */
export const barOf = (snapshot: UpdatesSnapshot | undefined): BarStatus =>
  snapshot
    ? { text: snapshot.text, tooltip: snapshot.tooltip, class: snapshot.class }
    : loadingBar;

/** The `--json` output: the status, its groups, and the bar and footer output. */
export const snapshotJson = (snapshot: UpdatesSnapshot | undefined) => {
  const bar = barOf(snapshot);

  return {
    checkedAt: snapshot?.checkedAt ?? null,
    status: snapshot?.status ?? null,
    groups: snapshot ? pendingGroups(snapshot.status) : [],
    skills: snapshot?.status.skills ?? null,
    bar,
    footer: { ...bar, text: snapshot?.footerText ?? bar.text },
  };
};
