/**
 * @file Checks for everything `dot up` updates or installs: dotfiles, skills
 * and gh extensions. The OpenCode app updates system packages and tools
 * itself. The status cache and `dot up` share these checks.
 */

import { Effect, Match, Schema } from "effect";
import { query, type QueryResult } from "./boundedQuery.js";
import { Config } from "../services/Config.js";
import {
  ghExtensionsListPath,
  installedGhExtensions,
  loadGhExtensions,
} from "./ghExtensions.js";
import { SKILLS_CHECKOUT } from "./skillsMaintenance.js";

export { query, type QueryResult };

/** Whether the dotfiles and core repositories have updates to pull or apply. */
export const DotState = Schema.Literals(["current", "available", "unknown"]);

/** Dotfiles check result. */
export const DotStatus = Schema.Struct({
  state: DotState,
  pending: Schema.Array(Schema.String),
});

/** Dotfiles check result. */
export interface DotStatus extends Schema.Schema.Type<typeof DotStatus> {}

/** How far the managed skills checkout is behind skills `main`. */
export const SkillsStatus = Schema.Struct({
  behind: Schema.Int,
  changed: Schema.Array(Schema.String),
});

/** How far the managed skills checkout is behind skills `main`. */
export interface SkillsStatus extends Schema.Schema.Type<typeof SkillsStatus> {}

/** Every pending update and missing install, with null for a check that couldn't run. */
export const PendingStatus = Schema.Struct({
  dot: DotStatus,
  skills: Schema.NullOr(SkillsStatus),
  gh: Schema.NullOr(Schema.Array(Schema.String)),
});

/** Every pending update and missing install, with null for a check that couldn't run. */
export interface PendingStatus extends Schema.Schema.Type<
  typeof PendingStatus
> {}

/** Read the items `dot update --check` lists under its "N pending updates:" heading. */
const pendingItems = (output: string) => {
  const all = output.split("\n").map((line) => line.trim());
  const start = all.findIndex((line) => /^\d+ pending updates:$/.test(line));

  if (start === -1) return [];

  const items = all.slice(start + 1);

  const end = items.findIndex(
    (line) => line === "" || line.startsWith("Run `dot "),
  );

  return end === -1 ? items : items.slice(0, end);
};

/** Check the dotfiles and core repositories with `dot up --check-repos`. */
export const dotfiles = Effect.fn("PendingUpdates.dotfiles")(function* (
  timeout: number,
) {
  const result = yield* query("dot", ["up", "--check-repos"], timeout);

  const state = Match.value(result.code).pipe(
    Match.when(0, () => "current" as const),
    Match.when(10, () => "available" as const),
    Match.orElse(() => "unknown" as const),
  );

  return {
    state,
    pending: state === "available" ? pendingItems(result.stdout) : [],
  } satisfies DotStatus;
});

const skillNames = (listing: string) =>
  new Set(
    listing
      .split("\n")
      .flatMap((path) => /^([^/]+)\/SKILL\.md$/.exec(path.trim())?.[1] ?? []),
  );

/** Compare the managed skills checkout with the latest `main`, without moving it. */
export const skills = Effect.fn("PendingUpdates.skills")(function* (
  timeout: number,
) {
  const git = (args: readonly string[]) =>
    query("git", ["-C", SKILLS_CHECKOUT, ...args], timeout);

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

/**
 * Configured gh extensions that aren't installed. Upgrades have no typed
 * dry run, so `dot up` upgrades every extension instead of checking first.
 */
export const ghExtensions = Effect.fn("PendingUpdates.ghExtensions")(
  function* () {
    const config = yield* Config;
    const desired = loadGhExtensions(ghExtensionsListPath(config));

    if (desired.length === 0) return [];

    const installed = yield* installedGhExtensions;

    if (installed.size === 0) return null;

    return desired.filter((repo) => !installed.has(repo.toLowerCase())).sort();
  },
);

/** One kind of pending work, as the bar, the OpenCode footer and `dot up` show it. */
export interface PendingGroup {
  /** Stable identifier. */
  readonly id: "dotfiles" | "skills" | "gh";
  /** Display title. */
  readonly title: string;
  /** Nerd Font glyph for the bar. */
  readonly icon: string;
  /** Pending updates, one line each. */
  readonly pending: readonly string[];
  /** Missing installs, one line each. */
  readonly missing: readonly string[];
  /** Why `dot up` won't run this group yet, one line each. */
  readonly blocked: readonly string[];
  /** The check couldn't run. */
  readonly unknown: boolean;
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** Split a status into its display groups, in update order. */
export const pendingGroups = (
  status: PendingStatus,
): readonly PendingGroup[] => [
  {
    id: "dotfiles",
    title: "Dotfiles",
    icon: "\uF4B5",
    pending:
      status.dot.state === "available" && status.dot.pending.length === 0
        ? ["Updates available"]
        : status.dot.pending,
    missing: [],
    blocked: [],
    unknown: status.dot.state === "unknown",
  },
  {
    id: "skills",
    title: "Skills",
    icon: "\uF404",
    pending:
      status.skills && status.skills.behind > 0
        ? [
            `${plural(status.skills.behind, "commit")} behind${status.skills.changed.length > 0 ? `: ${status.skills.changed.join(", ")}` : ""}`,
          ]
        : [],
    missing: [],
    blocked: [],
    unknown: status.skills === null,
  },
  {
    id: "gh",
    title: "gh extensions",
    icon: "\uF408",
    pending: [],
    missing: status.gh ?? [],
    blocked: [],
    unknown: status.gh === null,
  },
];

/** Whether a group has anything to do. */
export const hasWork = (group: PendingGroup) =>
  group.pending.length > 0 || group.missing.length > 0;

/** A group's pending, missing and blocked lines, missing and blocked ones marked. */
export const groupLines = (group: PendingGroup) => [
  ...group.blocked.map((line) => `Blocked: ${line}`),
  ...group.missing.map((name) => `${name} (missing)`),
  ...group.pending,
];

/** Run every check at once. */
export const checkAll = Effect.fn("PendingUpdates.checkAll")(function* (
  timeout: number,
) {
  const status: PendingStatus = yield* Effect.all(
    {
      dot: dotfiles(timeout),
      skills: skills(timeout),
      gh: ghExtensions(),
    },
    { concurrency: "unbounded" },
  );

  return status;
});
