/**
 * @file Checks for everything `dot up` updates or installs: dotfiles, skills,
 * mise tools, system packages, Omarchy and gh extensions. The status bar cache
 * and `dot up` share these checks.
 */

import { Clock, Effect, FileSystem, Match, Option, Schema } from "effect";
import { lines, query, type QueryResult } from "./boundedQuery.js";
import { HOME_DIR } from "./paths.js";
import { missingArchPackages } from "./packageSetup.js";
import { Config } from "../services/Config.js";
import {
  ghExtensionsListPath,
  installedGhExtensions,
  loadGhExtensions,
} from "./ghExtensions.js";
import { SKILLS_CHECKOUT } from "./skillsMaintenance.js";
import { patchDrift } from "./omarchyPatches.js";

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

/** A mise tool with a newer version than the one installed. */
export const OutdatedTool = Schema.Struct({
  name: Schema.String,
  current: Schema.String,
  latest: Schema.String,
});

/** A mise tool with a newer version than the one installed. */
export interface OutdatedTool extends Schema.Schema.Type<typeof OutdatedTool> {}

/** Global mise tools with a newer version, and those not installed. */
export const ToolsStatus = Schema.Struct({
  outdated: Schema.Array(OutdatedTool),
  missing: Schema.Array(Schema.String),
});

/** Global mise tools with a newer version, and those not installed. */
export interface ToolsStatus extends Schema.Schema.Type<typeof ToolsStatus> {}

/** Pending pacman and AUR updates, and listed packages not installed. */
export const PackagesStatus = Schema.Struct({
  /** `name old -> new` lines from checkupdates and yay. */
  pending: Schema.Array(Schema.String),
  /** Packages from the public and private lists that aren't installed. */
  missing: Schema.Array(Schema.String),
  /** Whether the AUR check ran; pending is repository updates only when false. */
  aurChecked: Schema.Boolean,
  /** Whether the repository check ran. */
  repoChecked: Schema.Boolean,
});

/** Pending pacman and AUR updates, and listed packages not installed. */
export interface PackagesStatus extends Schema.Schema.Type<
  typeof PackagesStatus
> {}

/** Every pending update and missing install, with null for a check that couldn't run. */
export const PendingStatus = Schema.Struct({
  dot: DotStatus,
  skills: Schema.NullOr(SkillsStatus),
  tools: Schema.NullOr(ToolsStatus),
  packages: PackagesStatus,
  omarchy: Schema.NullOr(Schema.Array(Schema.String)),
  /** Dotfiles Omarchy patches that no longer apply to the pending Omarchy. */
  omarchyPatches: Schema.optionalKey(Schema.Array(Schema.String)),
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

const MiseOutdated = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      current: Schema.NullOr(Schema.String),
      latest: Schema.String,
    }),
  ),
);

const MiseMissing = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Array(Schema.Struct({ version: Schema.String })),
  ),
);

/**
 * Check the global mise tools. Tools pinned to a version only move when the
 * pin does, so only tools requesting a range or `latest` can be outdated.
 */
export const tools = Effect.fn("PendingUpdates.tools")(function* (
  timeout: number,
) {
  const [outdated, missing] = yield* Effect.all(
    [
      query("mise", ["outdated", "--json"], timeout, HOME_DIR),
      query("mise", ["ls", "--missing", "--json"], timeout, HOME_DIR),
    ],
    { concurrency: 2 },
  );

  if (outdated.code !== 0 || missing.code !== 0) return null;

  const decoded = yield* Effect.all([
    Schema.decodeEffect(MiseOutdated)(outdated.stdout),
    Schema.decodeEffect(MiseMissing)(missing.stdout),
  ]).pipe(Effect.option);

  if (Option.isNone(decoded)) return null;

  const [outdatedTools, missingTools] = decoded.value;

  return {
    outdated: Object.entries(outdatedTools)
      .flatMap(([name, { current, latest }]) =>
        current && current !== latest ? [{ name, current, latest }] : [],
      )
      .sort((a, b) => a.name.localeCompare(b.name)),
    missing: Object.keys(missingTools).sort(),
  } satisfies ToolsStatus;
});

const OMARCHY_PACKAGES = new Set(["omarchy", "omarchy-dev"]);

const AUR_HTTP_FAILURE_PATTERNS = [
  /\bstatus\b[^0-9]*\b[45][0-9]{2}\b/i,
  /\bhttp(?:\/\d+(?:\.\d+)?)?\b[^0-9]*\b[45][0-9]{2}\b/i,
] as const;

const BackoffState = Schema.Tuple([Schema.Int, Schema.Int]);

/** Where AUR request failures back off, and whether to honour it. */
export interface AurBackoff {
  /** File holding `<failures> <until epoch seconds>`. */
  readonly file: string;
  /** Skip the AUR check while backed off; manual checks retry at once. */
  readonly respect: boolean;
}

/**
 * Check every pending pacman and AUR update, and the public and private
 * package lists for packages that aren't installed. Omarchy's own package is
 * left to {@link omarchy}.
 */
export const packages = Effect.fn("PendingUpdates.packages")(function* (
  timeout: number,
  backoff?: AurBackoff,
) {
  const fs = yield* FileSystem.FileSystem;
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);

  const saved = backoff
    ? yield* fs.readFileString(backoff.file).pipe(
        Effect.map((text) => text.trim().split(/\s+/).map(Number)),
        Effect.flatMap(Schema.decodeUnknownEffect(BackoffState)),
        Effect.orElseSucceed(() => [0, 0] as const),
      )
    : ([0, 0] as const);

  const [failures, until] = saved;
  const aurSkipped = backoff?.respect === true && now < until;

  const [repo, aur, publicMissing, privateMissing] = yield* Effect.all(
    [
      query("checkupdates", ["--nocolor"], timeout),
      aurSkipped
        ? Effect.succeed<QueryResult>({
            code: 75,
            stdout: "",
            stderr: "backed off",
          })
        : query("yay", ["-Qua"], timeout),
      missingArchPackages("public"),
      missingArchPackages("private"),
    ],
    { concurrency: "unbounded" },
  );

  // checkupdates exits 2 when nothing is pending; yay -Qua exits 1.
  const repoChecked = repo.code === 0 || repo.code === 2;

  const aurChecked =
    (aur.code === 0 || aur.code === 1) && aur.stderr.trim() === "";

  if (backoff && !aurSkipped) {
    if (aurChecked) {
      yield* fs.remove(backoff.file, { force: true }).pipe(Effect.ignore);
    } else if (
      AUR_HTTP_FAILURE_PATTERNS.some((pattern) => pattern.test(aur.stderr))
    ) {
      const nextFailures = Math.min(5, Math.max(0, failures) + 1);
      const seconds = Math.min(21600, 1800 * 2 ** (nextFailures - 1));

      yield* fs
        .writeFileString(backoff.file, `${nextFailures} ${now + seconds}\n`, {
          mode: 0o600,
        })
        .pipe(Effect.ignore);
    }
  }

  const pending = [
    ...new Set([
      ...(repoChecked ? lines(repo.stdout) : []),
      ...(aurChecked ? lines(aur.stdout) : []),
    ]),
  ]
    .filter((line) => !OMARCHY_PACKAGES.has(line.split(/\s+/, 1)[0] ?? ""))
    .sort();

  return {
    pending,
    missing: [
      ...new Set([...(publicMissing ?? []), ...(privateMissing ?? [])]),
    ].sort(),
    aurChecked,
    repoChecked,
  } satisfies PackagesStatus;
});

/** Pending Omarchy updates (package or dev checkout), from `omarchy-update-available`. */
export const omarchy = Effect.fn("PendingUpdates.omarchy")(function* (
  timeout: number,
) {
  const result = yield* query("omarchy-update-available", [], timeout);

  // Exits 1 with "Omarchy is up to date" when nothing is pending.
  if (result.code === 1) return [];

  return result.code === 0 ? lines(result.stdout) : null;
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
  readonly id: "dotfiles" | "skills" | "tools" | "packages" | "omarchy" | "gh";
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
    id: "tools",
    title: "mise tools",
    icon: "\uF0AD",
    pending: (status.tools?.outdated ?? []).map(
      ({ name, current, latest }) => `${name} ${current} -> ${latest}`,
    ),
    missing: status.tools?.missing ?? [],
    blocked: [],
    unknown: status.tools === null,
  },
  {
    id: "packages",
    title: "Packages",
    icon: "\uF487",
    pending: status.packages.pending,
    missing: status.packages.missing,
    blocked: [],
    unknown: !status.packages.repoChecked || !status.packages.aurChecked,
  },
  {
    id: "omarchy",
    title: "Omarchy",
    icon: "\uF303",
    pending: status.omarchy ?? [],
    missing: [],
    blocked: (status.omarchyPatches ?? []).map(
      (name) => `${name} no longer applies`,
    ),
    unknown: status.omarchy === null,
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

/**
 * Check the dotfiles Omarchy patches against the pending Omarchy package.
 * Returns the patches that no longer apply, or none when nothing is pending
 * or the check couldn't run.
 */
export const omarchyPatchDrift = Effect.fn("PendingUpdates.omarchyPatches")(
  function* (pendingOmarchy: readonly string[] | null, timeout: number) {
    if (!pendingOmarchy || pendingOmarchy.length === 0) return [];

    const drift = yield* patchDrift(timeout);

    return drift?.failing ?? [];
  },
);

/** Run every check at once. */
export const checkAll = Effect.fn("PendingUpdates.checkAll")(function* (
  timeout: number,
  backoff?: AurBackoff,
) {
  const checked = yield* Effect.all(
    {
      dot: dotfiles(timeout),
      skills: skills(timeout),
      tools: tools(timeout),
      packages: packages(timeout, backoff),
      omarchy: omarchy(timeout),
      gh: ghExtensions(),
    },
    { concurrency: "unbounded" },
  );

  const status: PendingStatus = {
    ...checked,
    omarchyPatches: yield* omarchyPatchDrift(checked.omarchy, timeout),
  };

  return status;
});
