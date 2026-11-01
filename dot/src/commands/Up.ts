/**
 * @file `dot up`: check everything, pick what to run, then run it in order:
 * dotfiles, gh extensions and compose up, then the distro branch update. The
 * OpenCode app installs and updates system packages and tools itself.
 */

import { Extension } from "@timmo001/effect-gh";
import { herdrSdkLayerFromOptions } from "@timmo001/effect-herdr";
import { Cause, Clock, Duration, Effect, FileSystem } from "effect";
import { Prompt } from "effect/cli";
import { DotDiff } from "../git/services/DotDiff.js";
import { cliStyler, type Styler } from "../lib/ansi.js";
import { gitOutput } from "../lib/git.js";
import { SKILLS_CHECKOUT } from "../lib/skillsMaintenance.js";
import { ENV, envString } from "../lib/env.js";
import { formatCause } from "../lib/schema.js";
import { DEFAULT_SOCKET_PATH, openHerdrRepo } from "./HerdrRepoOpen.js";
import { branchUpdate } from "./BranchUpdate.js";
import { COMPOSE_CONFIG, composeUp } from "./Compose.js";
import {
  checkAll,
  groupLines,
  hasWork,
  pendingGroups,
  type PendingGroup,
  type PendingStatus,
} from "../lib/pendingUpdates.js";
import {
  done,
  logRepoChanges,
  logUpdateSummary,
  skip,
  warn,
  type MiseToolChange,
  type RecapEntry,
  type UpdatedRepo,
} from "../lib/updateSummary.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import {
  CORE_CHECK_CATEGORIES,
  update,
  UP_GROUPS,
  UPDATE_CHECK_AVAILABLE_EXIT,
  UPDATE_CHECK_ERROR_EXIT,
  type UpdateOptions,
  type UpGroup,
} from "./Update.js";
import { saveStatus } from "./Updates.js";

/** Seconds each check may take. */
const CHECK_TIMEOUT = 120;

const GROUP_INFO: Record<
  UpGroup,
  { readonly title: string; readonly description: string }
> = {
  dotfiles: {
    title: "Dotfiles",
    description:
      "Pull the dotfiles and tracked repositories, stow, rebuild dot and move the skills checkout",
  },
  gh: {
    title: "gh extensions",
    description: "Install missing gh extensions and upgrade the others",
  },
  compose: {
    title: "Compose",
    description: "Pull and start the compose files with dot compose up",
  },
};

/** Which `dot up` group handles each checked group's work. */
const groupWork = (groups: readonly PendingGroup[]) => {
  const byId = new Map(groups.map((group) => [group.id, group]));

  const lines = (...ids: PendingGroup["id"][]) =>
    ids.flatMap((id) => {
      const group = byId.get(id);

      return group ? groupLines(group) : [];
    });

  return {
    dotfiles: lines("dotfiles", "skills"),
    gh: lines("gh"),
    compose: [],
  } satisfies Record<UpGroup, readonly string[]>;
};

/** Colour a pending work line by its shape, leaving unknown shapes plain. */
const styleWorkLine = (style: Styler, line: string) => {
  const blocked = /^Blocked: (.*)$/.exec(line);

  if (blocked) return `${style.error("Blocked:")} ${blocked[1] ?? ""}`;

  const missing = /^(.*) \(missing\)$/.exec(line);

  if (missing)
    return `${style.accent(missing[1] ?? "")} ${style.warn("(missing)")}`;

  const version = /^(\S+) (\S+) -> (\S+)$/.exec(line);

  if (version) {
    const [, name = "", from = "", to = ""] = version;

    return `${style.accent(name)} ${style.warn(from)} ${style.dim("->")} ${style.success(to)}`;
  }

  const behind = /^(?:(.+): )?(\d+ (?:commits? )?behind)(.*)$/.exec(line);

  if (behind) {
    const [, name, count = "", rest = ""] = behind;

    return `${name ? `${style.accent(name)}: ` : ""}${style.success(count)}${style.dim(rest)}`;
  }

  return line;
};

/**
 * Log the commits and changed files each pending pull brings in, from where
 * the checkout and its upstream split, as the Git panel shows incoming changes.
 */
const logIncoming = Effect.fn("Up.incoming")(function* (status: PendingStatus) {
  const dotDiff = yield* DotDiff;
  const log = yield* OutputLog;

  const repos = yield* dotDiff
    .getAll({ categories: CORE_CHECK_CATEGORIES })
    .pipe(Effect.orElseSucceed(() => []));

  const behind = [
    ...repos
      .filter((repo) => repo.behind > 0)
      .map((repo) => ({ name: repo.name, path: repo.path, to: "@{u}" })),
    ...(status.skills && status.skills.behind > 0
      ? [{ name: "skills", path: SKILLS_CHECKOUT, to: "origin/main" }]
      : []),
  ];

  const ranges = yield* Effect.forEach(
    behind,
    (repo) =>
      gitOutput(["merge-base", "HEAD", repo.to], { cwd: repo.path }).pipe(
        Effect.map((base) => [{ ...repo, from: base.trim() }]),
        Effect.orElseSucceed(() => []),
      ),
    { concurrency: "unbounded" },
  );

  yield* logRepoChanges(ranges.flat());

  if (ranges.some((range) => range.length > 0)) yield* log.info("");
});

/** Options for `dot up`. */
export interface UpOptions extends UpdateOptions {
  /** Offer every group, even those with nothing pending. */
  readonly force?: boolean;
}

const interactive = () =>
  process.stdin.isTTY === true && process.stdout.isTTY === true;

/**
 * Without a terminal, the group picker hangs, so once
 * the check finds work, rerun `dot up` in a Herdr tab in the dotfiles
 * workspace, where the user can answer them and an agent can read the pane.
 * Fails the run when Herdr can't open one.
 */
const handOffToHerdr = Effect.fn("Up.handOffToHerdr")(function* (
  opts: UpOptions,
) {
  const config = yield* Config;
  const log = yield* OutputLog;

  const command = [
    "dot",
    "up",
    ...(opts.force ? ["--force"] : []),
    ...(opts.yes ? ["--yes"] : []),
    ...(opts.selfUpdate === false ? ["--no-self-update"] : []),
    ...(opts.reload === false ? ["--no-reload"] : []),
    ...(opts.branch === false ? ["--no-branch"] : []),
  ].join(" ");

  const opened = yield* openHerdrRepo({
    layout: "tab",
    label: "dotfiles",
    directory: config.publicDotfiles,
    tabLabel: "dot up",
    command,
  }).pipe(
    Effect.provide(
      herdrSdkLayerFromOptions({
        socketPath: envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH,
        requestTimeout: Duration.seconds(5),
      }),
    ),
    Effect.map((result) => result.paneId),
    Effect.catchCause((cause) =>
      log
        .error(
          `dot up needs a terminal and could not open one in Herdr: ${formatCause(Cause.squash(cause))}`,
        )
        .pipe(Effect.as(null)),
    ),
  );

  if (opened === null) {
    yield* log.info("Run dot up in a terminal instead");
    process.exitCode = 1;

    return;
  }

  yield* log.success(`Running ${command} in Herdr pane ${opened}`);
  yield* log.info(`Follow it with herdr pane read ${opened}`);
});

/** Report everything pending, exiting 10 when there is work and 2 when a check failed. */
export const upCheck = Effect.gen(function* () {
  const log = yield* OutputLog;

  yield* log.section("Update Check");

  const status = yield* checkAll(CHECK_TIMEOUT);
  yield* saveStatus(status).pipe(Effect.ignore);

  const groups = pendingGroups(status);
  const style = cliStyler();

  const working = groups.filter(
    (group) => hasWork(group) || group.blocked.length > 0,
  );

  for (const group of groups) {
    if (hasWork(group) || group.blocked.length > 0) {
      yield* log.info(style.label(`${group.title}:`));

      for (const line of groupLines(group))
        yield* log.info(`  ${styleWorkLine(style, line)}`);
    } else {
      yield* log.info(
        `${style.label(`${group.title}:`)} ${group.unknown ? style.warn("unavailable") : style.dim("up to date")}`,
      );
    }
  }

  if (working.length > 0) {
    yield* log.info("Run `dot up` to apply.");
  }

  yield* Effect.sync(() => {
    process.exitCode =
      working.length > 0
        ? UPDATE_CHECK_AVAILABLE_EXIT
        : groups.some((group) => group.unknown)
          ? UPDATE_CHECK_ERROR_EXIT
          : 0;
  });
}).pipe(Effect.withSpan("Up.check"));

/**
 * Pick the groups to run, all with work ticked. gh extensions and compose
 * have no dry run, so they are always offered.
 */
const pickGroups = Effect.fn("Up.pick")(function* (
  work: Record<UpGroup, readonly string[]>,
  opts: UpOptions,
) {
  const fs = yield* FileSystem.FileSystem;

  const compose = yield* fs
    .exists(COMPOSE_CONFIG)
    .pipe(Effect.orElseSucceed(() => false));

  const offered: UpGroup[] = UP_GROUPS.filter((group) =>
    group === "compose"
      ? compose
      : opts.force || group === "gh" || work[group].length > 0,
  );

  if (opts.yes) return offered;

  return yield* Prompt.run(
    Prompt.MultiSelect({
      message: "Choose updates:",
      choices: offered.map((group) => ({
        title: GROUP_INFO[group].title,
        value: group,
        description:
          work[group].length > 0
            ? work[group].slice(0, 3).join(", ") +
              (work[group].length > 3 ? ", ..." : "")
            : GROUP_INFO[group].description,
        selected: true,
      })),
    }),
  ).pipe(
    Effect.catchTag("QuitError", () => Effect.succeed(offered.slice(0, 0))),
    // NodeTerminal retains its raw readline resource for a 10 ms idle window.
    Effect.tap(() => Effect.sleep("20 millis")),
  );
});

const ghUpgrade = Effect.gen(function* () {
  const exitCode = yield* Extension.upgradeAll({
    interactive: true,
    timeout: null,
  }).pipe(
    Effect.as(0),
    Effect.catchTag("GhCommandError", (error) =>
      Effect.succeed(error.exitCode),
    ),
    Effect.orElseSucceed(() => 1),
  );

  return exitCode === 0
    ? done("Upgraded gh extensions")
    : warn(`gh extension upgrade exited ${exitCode}`);
}).pipe(Effect.withSpan("Up.gh"));

/** Hand behind distro branches to a rebase agent, unless --no-branch. */
const updateBranches = (opts: UpOptions) =>
  opts.branch === false
    ? Effect.succeed(skip("Branch update skipped (--no-branch)"))
    : branchUpdate;

/**
 * Run `dot up`. A fresh run checks everything and asks which groups to run;
 * a run restarted by the dotfiles self-update carries its groups instead.
 */
export const up = Effect.fn("Up.run")(function* (opts: UpOptions) {
  const log = yield* OutputLog;
  const executor = yield* CommandExecutor;
  const startedAt = opts.startedAt ?? (yield* Clock.currentTimeMillis);
  const restarted = (opts.groups?.length ?? 0) > 0;

  let status: PendingStatus | null = null;
  let groups: readonly UpGroup[];

  if (restarted) {
    groups = opts.groups ?? [];
  } else {
    yield* log.section("Checking For Updates");
    status = yield* log.withSpinner(
      "Checking everything",
      checkAll(CHECK_TIMEOUT),
    );
    yield* saveStatus(status).pipe(Effect.ignore);

    const work = groupWork(pendingGroups(status));
    const style = cliStyler();

    for (const group of UP_GROUPS) {
      if (work[group].length === 0) continue;

      yield* log.info(style.label(`${GROUP_INFO[group].title}:`));

      for (const line of work[group])
        yield* log.info(`  ${styleWorkLine(style, line)}`);

      if (group === "dotfiles") yield* logIncoming(status);
    }

    if (!opts.force && UP_GROUPS.every((group) => work[group].length === 0)) {
      yield* log.success("Everything is up to date");
      yield* updateBranches(opts);

      return;
    }

    // Only work that needs prompts answered opens a Herdr tab.
    if (!interactive()) return yield* handOffToHerdr(opts);

    groups = yield* pickGroups(work, opts);
  }

  if (groups.length === 0) {
    yield* log.info("Nothing picked");

    return;
  }

  const picked = new Set(groups);
  const ordered = UP_GROUPS.filter((group) => picked.has(group));
  const updatedRepos: UpdatedRepo[] = [];
  const miseToolChanges: MiseToolChange[] = [];
  const actions: RecapEntry[] = [];

  for (const [index, group] of ordered.entries()) {
    yield* log.section(
      `[${index + 1}/${ordered.length}] ${GROUP_INFO[group].title}`,
    );
    yield* log.info(GROUP_INFO[group].description);

    if (group === "dotfiles") {
      const result = yield* update({
        ...opts,
        startedAt,
        groups: ordered,
        yes: true,
        inUp: true,
      });

      // The restarted binary carries on with the picked groups.
      if (result === "restarted") return;

      updatedRepos.push(...result.updatedRepos);
      miseToolChanges.push(...result.miseToolChanges);
      actions.push(...result.completedActions);
    } else if (group === "gh") {
      actions.push(yield* ghUpgrade);
    } else {
      const exitCode = yield* composeUp([]);

      if (exitCode !== 0) process.exitCode = exitCode;

      actions.push(
        exitCode === 0
          ? done("Ran compose up")
          : warn(`Compose up exited ${exitCode}`),
      );
    }
  }

  const refreshExitCode = yield* executor.exitCode("dot", [
    "updates",
    "refresh",
  ]);

  actions.push(
    refreshExitCode === 0
      ? done("Refreshed the update status")
      : warn(`Update status refresh failed (exit ${refreshExitCode})`),
  );

  actions.push(yield* updateBranches(opts));

  yield* logUpdateSummary(updatedRepos, miseToolChanges, actions, startedAt);
});
