/**
 * @file `dot up`: check everything, pick from the groups with work, then run
 * them in order. A stage the check found no work for only runs when an
 * earlier stage changed something it applies, such as stow after a dotfiles
 * pull.
 */

import { Extension } from "@timmo001/effect-gh";
import { herdrSdkLayerFromOptions } from "@timmo001/effect-herdr";
import { Cause, Clock, Duration, Effect } from "effect";
import { Prompt } from "effect/cli";
import { DotDiff } from "../git/services/DotDiff.js";
import { isAgent } from "../lib/agent.js";
import { cliStyler, type Styler } from "../lib/ansi.js";
import { gitOutput } from "../lib/git.js";
import { SKILLS_CHECKOUT } from "../lib/skillsMaintenance.js";
import { ENV, envString } from "../lib/env.js";
import { formatCause } from "../lib/schema.js";
import { installGhExtensions } from "../lib/ghExtensions.js";
import { DEFAULT_SOCKET_PATH, openHerdrRepo } from "./HerdrRepoOpen.js";
import {
  loadPrivatePackageRepoConfig,
  privatePackageRepoIncludeRegistered,
} from "../doctor/checks/packages.js";
import { setupPrivatePackageRepo } from "./SetupPrivateRepo.js";
import { patchDrift, syncRootPatches } from "../lib/omarchyPatches.js";
import { installMissingArchPackages } from "../lib/packageSetup.js";
import {
  agentPlugins,
  checkAll,
  groupLines,
  hasWork,
  pendingGroups,
  tools as checkTools,
  type PendingGroup,
  type PendingStatus,
} from "../lib/pendingUpdates.js";
import {
  hasLocalUpdateWork,
  pullKeepsLocalWork,
} from "../lib/updateMaintenance.js";
import {
  done,
  logRepoChanges,
  logUpdateSummary,
  notable,
  skip,
  warn,
  type MiseToolChange,
  type RecapEntry,
  type UpdatedRepo,
} from "../lib/updateSummary.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import type { DiffRepo } from "../types.js";
import {
  CORE_CHECK_CATEGORIES,
  isUpStage,
  reportPendingUpdates,
  UP_GROUPS,
  UPDATE_CHECK_AVAILABLE_EXIT,
  UPDATE_CHECK_ERROR_EXIT,
  type UpdateOptions,
  type UpGroup,
} from "./Update.js";
import { runUpStage, type UpStageResult } from "./UpStage.js";
import { restartDot } from "../lib/selfUpdate.js";
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
      "Pull the public and private dotfiles and their pinned submodules, and rebuild dot",
  },
  skills: {
    title: "Skills",
    description:
      "Move the skills checkout to the latest main, rebuild skill-maintenance and relink skills",
  },
  repos: {
    title: "Repositories",
    description:
      "Pull tracked repositories that are behind, leaving any with work in progress alone",
  },
  stow: {
    title: "Stow",
    description: "Generate completions, sync MCP config and skills, and stow",
  },
  tools: {
    title: "Mise tools",
    description:
      "Install missing mise tools and upgrade the rest, with no release delay",
  },
  plugins: {
    title: "Agent plugins",
    description: "Update the Pi, Plannotator and OpenCode plugins",
  },
  herdr: {
    title: "Herdr",
    description: "Restore pinned Herdr plugins and sync the saved machines",
  },
  agents: {
    title: "Agents",
    description:
      "Sync agent instructions, and reload running agents when skills or plugins changed",
  },
  shell: {
    title: "Shell",
    description: "Refresh shell modules and start the doctor check",
  },
  gh: {
    title: "gh extensions",
    description: "Install missing gh extensions and upgrade the installed ones",
  },
  packages: {
    title: "Missing packages",
    description: "Install packages from the public and private lists",
  },
  system: {
    title: "System",
    description:
      "Hand over to omarchy update for pacman, AUR and Omarchy updates",
  },
};

/**
 * Which `dot up` stage or group handles each line of the check's work:
 * tracked repository pulls go to repos, stow and Herdr pin maintenance to
 * stow and herdr, and the rest of the dotfiles work to the dotfiles stage.
 */
const groupWork = (
  groups: readonly PendingGroup[],
  repoPulls: readonly RepoPull[],
) => {
  const byId = new Map(groups.map((group) => [group.id, group]));

  const lines = (...ids: PendingGroup["id"][]) =>
    ids.flatMap((id) => {
      const group = byId.get(id);

      return group ? groupLines(group) : [];
    });

  const packages = byId.get("packages");
  const dotfiles = lines("dotfiles");
  const isPull = (line: string) => repoPulls.some((repo) => repo.line === line);
  const isStow = (line: string) => line.endsWith(" needs stow");

  const isHerdrPin = (line: string) =>
    / Herdr pin .* needs restoring$/.test(line);

  return {
    dotfiles: dotfiles.filter(
      (line) => !isPull(line) && !isStow(line) && !isHerdrPin(line),
    ),
    skills: lines("skills"),
    repos: dotfiles.filter(isPull),
    stow: dotfiles.filter(isStow),
    tools: lines("tools"),
    plugins: lines("plugins"),
    herdr: dotfiles.filter(isHerdrPin),
    agents: [],
    shell: [],
    gh: lines("gh"),
    packages: (packages?.missing ?? []).map((name) => `${name} (missing)`),
    system: [...(packages?.pending ?? []), ...lines("omarchy")],
  } satisfies Record<UpGroup, readonly string[]>;
};

/**
 * Whether a stage the check found no work for still needs to run, because a
 * stage before it changed something it applies: a dotfiles pull brings stow
 * links, mise config, Herdr pins and agent instructions; a mise upgrade can
 * move the Plannotator CLI its plugins follow; changed skills or plugins need
 * running agents reloaded; and the shell refreshes after any change. Tools and
 * plugins are checked again before they run.
 */
const followsOn = (
  group: UpGroup,
  changed: ReadonlySet<UpGroup>,
  reload: boolean,
) => {
  switch (group) {
    case "stow":
    case "tools":
    case "herdr":
      return changed.has("dotfiles");
    case "plugins":
      return changed.has("tools");
    case "agents":
      return changed.has("dotfiles") || reload;
    case "shell":
      return changed.size > 0;
    default:
      return false;
  }
};

/** Check a follow-on stage again, now earlier stages have run, for whether it has work. */
const stillNeeded = Effect.fn("Up.stillNeeded")(function* (group: UpGroup) {
  if (group === "tools") {
    const status = yield* checkTools(CHECK_TIMEOUT);

    return (
      status === null || status.outdated.length > 0 || status.missing.length > 0
    );
  }

  if (group === "plugins") {
    const pending = yield* agentPlugins(CHECK_TIMEOUT);

    return pending === null || pending.length > 0;
  }

  return true;
});

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

/** A tracked repository outside the dotfiles that only needs pulling. */
interface RepoPull {
  /** Checkout path. */
  readonly path: string;
  /** Its line in the update check. */
  readonly line: string;
}

/**
 * Match the check's pending lines to tracked repositories outside the
 * dotfiles, so the check's skips for local work still apply.
 */
const repoPulls = (
  repos: readonly DiffRepo[],
  pending: readonly string[],
): readonly RepoPull[] =>
  repos.flatMap((repo) => {
    if (CORE_CHECK_CATEGORIES.has(repo.category) || repo.behind === 0)
      return [];

    const line = pending.find((item) => item.startsWith(`${repo.name}: `));

    return line ? [{ path: repo.path, line }] : [];
  });

/**
 * Repositories the update check would pull: behind upstream, and not blocked
 * by local work a fast-forward would touch.
 *
 * A dotfiles restart only carries the picked group names. The repos stage
 * treats an empty path list as "every safe default-branch repository", which
 * drops feature-branch pulls the check already showed, so a restarted run
 * rebuilds this list instead of passing nothing.
 */
const pendingRepoPulls = Effect.fn("Up.pendingRepoPulls")(function* () {
  const log = yield* OutputLog;

  const repos = yield* (yield* DotDiff)
    .getAll()
    .pipe(
      Effect.catch((error) =>
        log
          .warn(
            `Could not rescan tracked repositories, so only safe default-branch checkouts will be pulled: ${error.message}`,
          )
          .pipe(Effect.as<readonly DiffRepo[]>([])),
      ),
    );

  const chosen = yield* Effect.forEach(
    repos.filter(
      (repo) => !CORE_CHECK_CATEGORIES.has(repo.category) && repo.behind > 0,
    ),
    (repo) =>
      Effect.gen(function* () {
        if (
          (yield* hasLocalUpdateWork(repo)) &&
          !(yield* pullKeepsLocalWork(repo))
        )
          return null;

        return {
          path: repo.path,
          line: `${repo.name}: ${repo.behind} behind`,
        } satisfies RepoPull;
      }).pipe(
        Effect.catch((error) =>
          log
            .warn(
              `Could not check ${repo.name}, so it won't be pulled: ${error.message}`,
            )
            .pipe(Effect.as(null)),
        ),
      ),
    { concurrency: 6 },
  );

  return chosen.flatMap((repo) => (repo === null ? [] : [repo]));
});

/**
 * Log the commits and changed files each pending pull brings in, from where
 * the checkout and its upstream split, as the Git panel shows incoming changes.
 */
const logIncoming = Effect.fn("Up.incoming")(function* (
  status: PendingStatus,
  repos: readonly DiffRepo[],
) {
  const log = yield* OutputLog;

  const behind = [
    ...repos.flatMap((repo) =>
      repo.behind > 0 ? [{ name: repo.name, path: repo.path, to: "@{u}" }] : [],
    ),
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
  /** Groups offered but not picked, carried across restart handoffs so they don't run as follow-ons. */
  readonly declined?: readonly UpGroup[];
  /** Stages that changed something before a restart handoff, so the stages that apply it follow. */
  readonly changed?: readonly UpGroup[];
}

const interactive = () =>
  process.stdin.isTTY === true && process.stdout.isTTY === true;

/**
 * Without a terminal, prompts such as the group picker and omarchy update's
 * sudo password hang, so once the check finds work, rerun `dot up` in a Herdr tab in the dotfiles
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

/** Pick the groups to run from those with work, all ticked. */
const pickGroups = Effect.fn("Up.pick")(function* (
  work: Record<UpGroup, readonly string[]>,
  opts: UpOptions,
) {
  const offered: UpGroup[] = UP_GROUPS.filter(
    (group) => opts.force || work[group].length > 0,
  );

  if (opts.yes) return { offered, picked: offered };

  const picked = yield* Prompt.run(
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

  return { offered, picked };
});

/** Offer a Herdr agent to fix patches that no longer apply. */
const offerPatchAgent = Effect.fn("Up.offerPatchAgent")(function* (
  failing: readonly string[],
) {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  if (!interactive() || isAgent()) {
    yield* log.info(
      "Fix the patches in scripts/.local/share/omarchy-patches, then run dot up again",
    );

    return;
  }

  const open = yield* Prompt.run(
    Prompt.Confirm({
      message: "Open an agent in Herdr to fix them?",
      initial: true,
    }),
  ).pipe(
    Effect.catchTag("QuitError", () => Effect.succeed(false)),
    Effect.tap(() => Effect.sleep("20 millis")),
  );

  if (!open) return;

  yield* executor.inherit("dot", [
    "herdr",
    "repo",
    "open",
    "--agent",
    "opencode2",
    "--prompt",
    `The pending Omarchy update no longer takes these dotfiles patches: ${failing.join(", ")}. Update them in scripts/.local/share/omarchy-patches against the new Omarchy, check each with \`dot up --check\`, then run \`dot up\`.`,
    "dotfiles",
    config.publicDotfiles,
  ]);
});

/** Register the private pacman repo before pacman needs it, if it went missing. */
const ensurePrivateRepo = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;

  if (!config.canUsePrivate) return;

  const repo = yield* loadPrivatePackageRepoConfig(config);

  if (!repo || (yield* privatePackageRepoIncludeRegistered())) return;

  yield* log.info("Registering the private pacman repo");
  yield* setupPrivatePackageRepo(repo).pipe(
    Effect.catch((error) =>
      log.warn(`Could not register the private pacman repo: ${error.message}`),
    ),
  );
}).pipe(Effect.withSpan("Up.ensurePrivateRepo"));

/** The Omarchy system step, held back when the patches no longer apply. */
const systemUpdate = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  const drift = yield* patchDrift(CHECK_TIMEOUT);

  if (drift && drift.failing.length > 0) {
    yield* log.error(
      `Held back omarchy update: ${drift.failing.join(", ")} no longer ${drift.failing.length === 1 ? "applies" : "apply"} to the pending Omarchy`,
    );
    yield* offerPatchAgent(drift.failing);
    process.exitCode = 1;

    return warn(`System update held back (${drift.failing.join(", ")})`);
  }

  yield* ensurePrivateRepo;

  // Ticking System in the picker already confirmed it, so skip Omarchy's own
  // ready prompt. -y also makes Omarchy's later prompts unattended.
  const exitCode = yield* executor.inherit("omarchy", ["update", "-y"]);

  if (exitCode !== 0) {
    process.exitCode = exitCode;

    return warn(`omarchy update exited ${exitCode}`);
  }

  return notable("Ran omarchy update");
}).pipe(Effect.withSpan("Up.system"));

const ghUpgrade = Effect.gen(function* () {
  yield* installGhExtensions;

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
    ? done("Installed and upgraded gh extensions")
    : warn(`gh extension upgrade exited ${exitCode}`);
}).pipe(Effect.withSpan("Up.gh"));

/**
 * Run `dot up`. A fresh run checks everything and asks which groups to run;
 * a run restarted by the dotfiles self-update carries its groups instead.
 */
export const up = Effect.fn("Up.run")(function* (opts: UpOptions) {
  const log = yield* OutputLog;
  const startedAt = opts.startedAt ?? (yield* Clock.currentTimeMillis);
  const changed = new Set<UpGroup>(opts.changed ?? []);
  const restarted = (opts.groups?.length ?? 0) > 0 || changed.size > 0;

  let status: PendingStatus | null = null;
  let groups: readonly UpGroup[];
  let declined: ReadonlySet<UpGroup> = new Set(opts.declined ?? []);
  let pulls: readonly RepoPull[] = [];

  if (restarted) {
    groups = opts.groups ?? [];

    // The handoff keeps group names only. Rebuild the check's pull list so
    // the repos stage does not fall through to its unnamed default-branch scan.
    if (groups.includes("repos")) pulls = yield* pendingRepoPulls();
  } else {
    yield* log.section("Checking For Updates");

    status = yield* log.withSpinner(
      "Checking everything",
      checkAll(CHECK_TIMEOUT),
    );
    yield* saveStatus(status).pipe(Effect.ignore);

    // The check has just fetched, so this scan reads the cached upstreams.
    const dotDiff = yield* DotDiff;

    const repos = yield* dotDiff
      .getAll()
      .pipe(Effect.orElseSucceed((): readonly DiffRepo[] => []));

    pulls = repoPulls(repos, status.dot.pending);

    const work = groupWork(pendingGroups(status), pulls);
    const style = cliStyler();

    for (const group of UP_GROUPS) {
      if (work[group].length === 0) continue;

      yield* log.info(style.label(`${GROUP_INFO[group].title}:`));

      for (const line of work[group])
        yield* log.info(`  ${styleWorkLine(style, line)}`);

      if (group === "dotfiles" || group === "repos")
        yield* logIncoming(status, repos);
    }

    if (!opts.force && UP_GROUPS.every((group) => work[group].length === 0)) {
      yield* log.success("Everything is up to date");

      return;
    }

    // Only work that needs prompts answered opens a Herdr tab.
    if (!interactive()) return yield* handOffToHerdr(opts);

    const choice = yield* pickGroups(work, opts);

    groups = choice.picked;
    declined = new Set(
      choice.offered.filter((group) => !choice.picked.includes(group)),
    );
  }

  if (groups.length === 0 && changed.size === 0) {
    yield* log.info("Nothing picked");

    return;
  }

  const picked = new Set(groups);
  const ran = new Set<UpGroup>();
  const updatedRepos: UpdatedRepo[] = [];
  const miseToolChanges: MiseToolChange[] = [];
  const actions: RecapEntry[] = [];
  let agentsNeedReload = false;

  for (const [index, group] of UP_GROUPS.entries()) {
    if (!picked.has(group)) {
      if (
        declined.has(group) ||
        !followsOn(group, changed, agentsNeedReload) ||
        !(yield* stillNeeded(group))
      )
        continue;
    }

    yield* log.section(GROUP_INFO[group].title);
    yield* log.info(
      picked.has(group)
        ? GROUP_INFO[group].description
        : `${GROUP_INFO[group].description}, to apply what changed`,
    );
    ran.add(group);

    if (isUpStage(group)) {
      // Stages never prompt, so a spinner can hold the bottom line throughout.
      const result: UpStageResult = yield* log.withSpinner(
        GROUP_INFO[group].title,
        runUpStage(group, {
          repos: group === "repos" ? pulls.map((repo) => repo.path) : [],
          reload: opts.reload !== false && agentsNeedReload,
          refreshStatus: false,
        }),
      );

      updatedRepos.push(...result.updatedRepos);
      miseToolChanges.push(...result.miseTools);
      actions.push(...result.actions);
      agentsNeedReload ||= result.skillsChanged || result.pluginsChanged;

      if (result.changed) changed.add(group);

      if (result.failed) process.exitCode = 1;

      // The later stages run with the code the pull just brought in.
      if (group === "dotfiles" && result.restartNeeded) {
        const rest = UP_GROUPS.slice(index + 1).filter((next) =>
          picked.has(next),
        );

        yield* logUpdateSummary(
          updatedRepos,
          miseToolChanges,
          actions,
          startedAt,
        );
        yield* log.info("Restarting dot up with the rebuilt binary");
        yield* restartDot([
          "up",
          ...rest.flatMap((next) => ["--group", next]),
          ...[...declined].flatMap((next) => ["--declined", next]),
          ...[...changed].flatMap((next) => ["--changed", next]),
          ...(opts.yes ? ["--yes"] : []),
          ...(opts.reload === false ? ["--no-reload"] : []),
          "--started-at",
          String(startedAt),
        ]);

        return;
      }
    } else if (group === "gh") {
      actions.push(yield* ghUpgrade);
    } else if (group === "packages") {
      yield* installMissingArchPackages({ scope: "public" });
      yield* installMissingArchPackages({ scope: "private" });
      actions.push(done("Installed missing packages"));
    } else {
      const synced = yield* syncRootPatches();

      actions.push(
        synced === null
          ? warn("Could not install the Omarchy patch hook")
          : synced
            ? done("Installed the Omarchy patch hook")
            : skip("Omarchy patch hook already current"),
      );
      actions.push(yield* systemUpdate);
    }
  }

  if (!ran.has("system") && ran.has("stow")) {
    const synced = yield* syncRootPatches();

    if (synced) actions.push(done("Installed the Omarchy patch hook"));
    else if (synced === null)
      actions.push(warn("Could not install the Omarchy patch hook"));
  }

  yield* logUpdateSummary(updatedRepos, miseToolChanges, actions, startedAt);
  yield* reportPendingUpdates;
});
