/**
 * @file `dot up`: check everything, pick what to run, then run it in order:
 * dotfiles, mise tools, gh extensions, missing packages and the Omarchy
 * system update.
 */

import { Extension } from "@timmo001/effect-gh";
import { herdrSdkLayerFromOptions } from "@timmo001/effect-herdr";
import { Cause, Clock, Duration, Effect } from "effect";
import { Prompt } from "effect/cli";
import { isAgent } from "../lib/agent.js";
import { ENV, envString } from "../lib/env.js";
import { formatCause } from "../lib/schema.js";
import { DEFAULT_SOCKET_PATH, openHerdrRepo } from "./HerdrRepoOpen.js";
import {
  loadPrivatePackageRepoConfig,
  privatePackageRepoIncludeRegistered,
} from "../doctor/checks/packages.js";
import { setupPrivatePackageRepo } from "./SetupPrivateRepo.js";
import { patchDrift, syncRootPatches } from "../lib/omarchyPatches.js";
import { installMissingArchPackages } from "../lib/packageSetup.js";
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
import {
  refreshTools,
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
  tools: {
    title: "Mise tools",
    description:
      "Install missing mise tools and upgrade the rest, with no release delay",
  },
  gh: {
    title: "gh extensions",
    description: "Install missing gh extensions and upgrade the others",
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

/** Which `dot up` group handles each checked group's work. */
const groupWork = (groups: readonly PendingGroup[]) => {
  const byId = new Map(groups.map((group) => [group.id, group]));

  const lines = (...ids: PendingGroup["id"][]) =>
    ids.flatMap((id) => {
      const group = byId.get(id);

      return group ? groupLines(group) : [];
    });

  const packages = byId.get("packages");

  return {
    dotfiles: lines("dotfiles", "skills"),
    tools: lines("tools"),
    gh: lines("gh"),
    packages: (packages?.missing ?? []).map((name) => `${name} (missing)`),
    system: [...(packages?.pending ?? []), ...lines("omarchy")],
  } satisfies Record<UpGroup, readonly string[]>;
};

/** Options for `dot up`. */
export interface UpOptions extends UpdateOptions {
  /** Offer every group, even those with nothing pending. */
  readonly force?: boolean;
}

const interactive = () =>
  process.stdin.isTTY === true && process.stdout.isTTY === true;

/**
 * Without a terminal, prompts such as the group picker and omarchy update's
 * confirmation hang, so once the check finds work, rerun `dot up` in a Herdr tab in the dotfiles
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

  const working = groups.filter(
    (group) => hasWork(group) || group.blocked.length > 0,
  );

  for (const group of groups) {
    if (hasWork(group) || group.blocked.length > 0) {
      yield* log.info(`${group.title}:`);

      for (const line of groupLines(group)) yield* log.info(`  ${line}`);
    } else {
      yield* log.info(
        `${group.title}: ${group.unknown ? "unavailable" : "up to date"}`,
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

/** Pick the groups to run, all with work ticked. */
const pickGroups = Effect.fn("Up.pick")(function* (
  work: Record<UpGroup, readonly string[]>,
  opts: UpOptions,
) {
  const offered: UpGroup[] = UP_GROUPS.filter(
    (group) => opts.force || group === "gh" || work[group].length > 0,
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
const systemUpdate = Effect.fn("Up.system")(function* (yes: boolean) {
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

  const exitCode = yield* executor.inherit("omarchy", [
    "update",
    ...(yes ? ["-y"] : []),
  ]);

  if (exitCode !== 0) {
    process.exitCode = exitCode;

    return warn(`omarchy update exited ${exitCode}`);
  }

  return notable("Ran omarchy update");
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

    for (const group of UP_GROUPS) {
      if (work[group].length === 0) continue;

      yield* log.info(`${GROUP_INFO[group].title}:`);

      for (const line of work[group]) yield* log.info(`  ${line}`);
    }

    if (!opts.force && UP_GROUPS.every((group) => work[group].length === 0)) {
      yield* log.success("Everything is up to date");

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
        upgradeTools: picked.has("tools"),
      });

      // The restarted binary carries on with the picked groups.
      if (result === "restarted" || result === "halted") return;

      updatedRepos.push(...result.updatedRepos);
      miseToolChanges.push(...result.miseToolChanges);
      actions.push(...result.completedActions);
    } else if (group === "tools") {
      if (picked.has("dotfiles")) {
        yield* log.info("Upgraded with the dotfiles");
        continue;
      }

      const refreshed = yield* refreshTools(true);
      miseToolChanges.push(...refreshed.tools);
      actions.push(...refreshed.actions);
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
      actions.push(yield* systemUpdate(opts.yes === true));
    }
  }

  if (!picked.has("system") && picked.has("dotfiles")) {
    const synced = yield* syncRootPatches();

    if (synced) actions.push(done("Installed the Omarchy patch hook"));
    else if (synced === null)
      actions.push(warn("Could not install the Omarchy patch hook"));
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

  yield* logUpdateSummary(updatedRepos, miseToolChanges, actions, startedAt);
});
