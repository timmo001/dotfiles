/**
 * @file The stages of `dot up`, each runnable on its own as `dot up <stage>`:
 * dotfiles, skills, repos, stow, plugins, herdr, agents, gh and clean. A stage
 * never prompts or opens Herdr, so a background runner such as Upkeep can call
 * it, and with `--json` it prints one result saying what changed. The OpenCode
 * app installs and updates packages and tools itself.
 */
import { Extension } from "@timmo001/effect-gh";
import { Clock, Duration, Effect, FileSystem, Schema } from "effect";
import { basename, join } from "path";
import { DotDiff } from "../git/services/DotDiff.js";
import { syncNotesRemotes } from "../git/notesRemote.js";
import { mcpSync } from "../mcp/commands/McpSync.js";
import {
  reloadAgents,
  updateGlobalOpencodePlugins,
  updatePiExtensions,
} from "../lib/agentRuntime.js";
import { syncSkills } from "../lib/externalSkills.js";
import { installGhExtensions } from "../lib/ghExtensions.js";
import { gitCurrentBranch, gitOutput } from "../lib/git.js";
import { ensureInitCompleteMarker } from "../lib/initState.js";
import { printJson } from "../lib/jsonStdout.js";
import { plural } from "../lib/runSummary.js";
import {
  CACHE_DIR,
  CONFIG_DIR,
  DATA_DIR,
  displayPath,
  expandHomePath,
} from "../lib/paths.js";
import { trustRepoMiseConfigs } from "../lib/miseTrust.js";
import { syncNotesRepositoryDirectories } from "../lib/notesRepositoryDirectories.js";
import { cloneMissingGitConfigRepos } from "../lib/privateGitRepos.js";
import { formatCause } from "../lib/schema.js";
import { rebuild } from "../lib/selfUpdate.js";
import {
  buildSkillsMaintenance,
  installSkillsCheckoutTools,
  updateSkillsCheckout,
} from "../lib/skillsMaintenance.js";
import {
  hasLocalUpdateWork,
  pullKeepsLocalWork,
} from "../lib/updateMaintenance.js";
import {
  done,
  logUpdateSummary,
  notable,
  skip,
  warn,
} from "../lib/updateSummary.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { managedGitRepos } from "../services/GitConfig.js";
import { OutputLog } from "../services/OutputLog.js";
import type {
  MiseToolChange,
  RecapEntry,
  UpdatedRepo,
} from "../lib/updateSummary.js";
import type { DiffRepo } from "../types.js";
import { agentsSync } from "./AgentsSync.js";
import { syncHcMachines, syncHerdrMachines } from "./SetupHerdrMachines.js";
import { stow as runStow } from "./Stow.js";
import {
  notifyUpdated,
  reportPendingUpdates,
  restoreHerdrPlugins,
  runRepoPostUpdate,
  safePull,
  updatePinnedSubmodules,
  updateRepositories,
  type UpStage,
} from "./Update.js";

/** What one stage did, printed as JSON with `--json`. */
export interface UpStageResult {
  /** The stage that ran. */
  readonly stage: UpStage;
  /** Whether the stage changed anything on this machine. */
  readonly changed: boolean;
  /** Whether the stage failed; `error` says why. */
  readonly failed: boolean;
  /** Why the stage failed. */
  readonly error?: string;
  /** Each step's outcome, as the `dot up` summary lists them. */
  readonly actions: readonly RecapEntry[];
  /** Repositories the stage pulled. */
  readonly updatedRepos: readonly UpdatedRepo[];
  /** Mise tools installed, upgraded or removed. */
  readonly miseTools: readonly MiseToolChange[];
  /** Skills or agent config changed, so running agents need a reload to see them. */
  readonly skillsChanged: boolean;
  /** Agent plugins changed, so running agents need a reload to load them. */
  readonly pluginsChanged: boolean;
  /** The pull moved dot's own source, so later stages need the rebuilt binary. */
  readonly restartNeeded: boolean;
}

interface StageOutcome {
  readonly actions: readonly RecapEntry[];
  /** Why the stage failed, keeping its actions; a thrown failure replaces them. */
  readonly error?: string;
  readonly updatedRepos?: readonly UpdatedRepo[];
  readonly miseTools?: readonly MiseToolChange[];
  readonly skillsChanged?: boolean;
  readonly pluginsChanged?: boolean;
  readonly restartNeeded?: boolean;
}

/** Options for one stage run. */
export interface UpStageOptions {
  /** Repository paths for the repos stage; empty pulls every safe one. */
  readonly repos?: readonly string[];
  /** Whether the agents stage reloads running agents. */
  readonly reload?: boolean;
}

const changedBy = (actions: readonly RecapEntry[]) =>
  actions.some((entry) => entry.notable === true);

class StageError extends Schema.TaggedError<StageError>()("StageError", {
  message: Schema.String,
}) {}

/**
 * Pull both dotfiles and their pinned submodules, rebuilding dot when its
 * source moved. Applying the pull is the stow stage's job.
 */
const dotfilesStage = Effect.gen(function* () {
  const config = yield* Config;
  const actions: RecapEntry[] = [];
  const updatedRepos: UpdatedRepo[] = [];

  const checkouts = [config.publicDotfiles, config.privateDotfiles].filter(
    (path) => path !== null,
  );

  const ranges = yield* Effect.forEach(
    checkouts,
    (path) =>
      safePull(basename(path), path, true, true).pipe(
        Effect.map((range) => ({ path, range })),
      ),
    { concurrency: 2 },
  );

  for (const { path, range } of ranges) {
    if (range) updatedRepos.push({ name: basename(path), path, ...range });
  }

  actions.push(
    updatedRepos.length > 0
      ? notable(`Pulled ${updatedRepos.map((repo) => repo.name).join(", ")}`)
      : skip("Dotfiles already up to date"),
  );

  const pins = yield* Effect.forEach(checkouts, updatePinnedSubmodules);

  if (pins.some(Boolean)) actions.push(notable("Updated pinned submodules"));

  const built = yield* rebuild;

  actions.push(
    built
      ? notable("Rebuilt the dot binary")
      : skip("dot binary already built from this source"),
  );

  const marker = yield* ensureInitCompleteMarker(config, "update");

  if (marker === "created") actions.push(notable("Marked init state complete"));

  return {
    actions,
    updatedRepos,
    restartNeeded: built || updatedRepos.length > 0,
  } satisfies StageOutcome;
});

/** Move the skills checkout to the latest main, rebuild its tool and relink. */
const skillsStage = Effect.gen(function* () {
  const actions: RecapEntry[] = [];
  const checkout = yield* updateSkillsCheckout;
  const moved = checkout.from !== checkout.to;

  actions.push(
    moved
      ? notable(`Updated the skills checkout to ${checkout.to}`)
      : skip("Skills checkout already up to date"),
  );

  const tools = yield* installSkillsCheckoutTools;

  if (tools.length > 0)
    actions.push(
      notable(`Installed skills checkout tools: ${tools.join(", ")}`),
    );

  const { built } = yield* buildSkillsMaintenance;

  actions.push(
    built
      ? notable("Rebuilt the skill-maintenance executable")
      : skip("Skill-maintenance executable already built"),
  );

  const linked = yield* syncSkills;
  actions.push(...linked);

  return {
    actions,
    skillsChanged: moved || changedBy(linked),
  } satisfies StageOutcome;
});

/** Whether a checkout is on its upstream remote's default branch. */
const onDefaultBranch = Effect.fn("UpStage.onDefaultBranch")(function* (
  repo: DiffRepo,
) {
  const branch = yield* gitCurrentBranch(repo.path);

  const upstream = yield* gitOutput(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    { cwd: repo.path },
  ).pipe(Effect.orElseSucceed(() => ""));

  const remote = upstream.trim().split("/", 1)[0];

  if (!branch || !remote) return false;

  const head = yield* gitOutput(
    ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`],
    { cwd: repo.path },
  ).pipe(Effect.orElseSucceed(() => ""));

  return head.trim() === `refs/remotes/${remote}/${branch}`;
});

/** Why a background pull should leave a repository alone, or null when it's safe. */
const pullBlocker = Effect.fn("UpStage.pullBlocker")(function* (
  repo: DiffRepo,
) {
  if (!(yield* onDefaultBranch(repo))) return "not on its default branch";

  if (repo.ahead > 0) return "ahead of upstream";

  if ((yield* hasLocalUpdateWork(repo)) && !(yield* pullKeepsLocalWork(repo)))
    return "local work the pull would touch";

  return null;
});

/**
 * Pull the named repositories, or every tracked repository that is behind
 * where nobody is working: on the default branch, not ahead, and with any
 * local changes untouched by the incoming commits. The dotfiles have their
 * own stage.
 */
const reposStage = (paths: readonly string[]) =>
  Effect.gen(function* () {
    if (paths.length > 0) {
      const updatedRepos = yield* updateRepositories(paths, true);

      return {
        actions: [
          updatedRepos.length > 0
            ? notable(
                `Pulled ${updatedRepos.map((repo) => repo.name).join(", ")}`,
              )
            : skip("Repositories already up to date"),
        ],
        updatedRepos,
      } satisfies StageOutcome;
    }

    const config = yield* Config;
    const log = yield* OutputLog;
    const actions: RecapEntry[] = [];
    const updatedRepos: UpdatedRepo[] = [];

    const cloned = yield* cloneMissingGitConfigRepos({ strict: false });
    yield* trustRepoMiseConfigs(cloned);

    const repos = yield* (yield* DotDiff).getAll();

    const checked = yield* Effect.forEach(
      repos.filter((repo) => repo.category !== "dotfiles" && repo.behind > 0),
      (repo) =>
        pullBlocker(repo).pipe(
          Effect.orElseSucceed(() => "its state could not be read"),
          Effect.map((reason) => ({ repo, reason })),
        ),
      { concurrency: 6 },
    );

    for (const { repo, reason } of checked) {
      if (reason === null) continue;
      yield* log.info(`Leaving ${repo.name} alone (${reason})`);
      actions.push(skip(`${repo.name} left alone (${reason})`));
    }

    const pulled = yield* Effect.forEach(
      checked.flatMap(({ repo, reason }) => (reason === null ? [repo] : [])),
      (repo) =>
        safePull(repo.name, repo.path, false, true).pipe(
          Effect.map((range) => ({ repo, range })),
        ),
      { concurrency: 8 },
    );

    for (const { repo, range } of pulled) {
      if (!range) {
        actions.push(warn(`${repo.name} is behind but was not pulled`));
        continue;
      }

      yield* updatePinnedSubmodules(repo.path).pipe(Effect.ignore);
      updatedRepos.push({ name: repo.name, path: repo.path, ...range });
    }

    const updated = new Set(updatedRepos.map((repo) => repo.path));

    for (const repo of managedGitRepos(config.gitConfig)) {
      if (!updated.has(repo.path)) continue;
      yield* runRepoPostUpdate(repo).pipe(
        Effect.catch((error) =>
          Effect.sync(() => actions.push(warn(error.message))),
        ),
      );
    }

    yield* notifyUpdated(updatedRepos.map((repo) => repo.name));

    actions.unshift(
      updatedRepos.length > 0
        ? notable(`Pulled ${updatedRepos.map((repo) => repo.name).join(", ")}`)
        : skip("No repositories to pull"),
    );

    return { actions, updatedRepos } satisfies StageOutcome;
  });

/** Generate completions and sync MCP config, skills and stow links. */
const stowStage = Effect.gen(function* () {
  yield* mcpSync;
  yield* syncNotesRemotes;
  const result = yield* runStow();

  return {
    actions: [done("Synced MCP config"), ...result.actions],
    skillsChanged: changedBy(result.actions),
  } satisfies StageOutcome;
});

/**
 * Update the Pi and global OpenCode plugins.
 */
const pluginsStage = Effect.gen(function* () {
  const actions = [
    yield* updatePiExtensions,
    yield* updateGlobalOpencodePlugins,
  ];

  return {
    actions,
    pluginsChanged: changedBy(actions),
  } satisfies StageOutcome;
});

/**
 * Install the missing gh extensions and upgrade the rest. A dry run says
 * which will move, and the upgrade's own output is captured, so with
 * `--json` stdout stays the result alone.
 */
const ghStage = Effect.gen(function* () {
  yield* installGhExtensions;

  const pending = yield* Extension.checkUpgrades({ timeout: null }).pipe(
    Effect.orElseSucceed(() => []),
  );

  const failure = yield* Extension.upgradeAll({ timeout: null }).pipe(
    Effect.as(null),
    Effect.catchTag("GhCommandError", (error) => Effect.succeed(error)),
  );

  const failed =
    failure === null
      ? []
      : Extension.parseUpgrades(failure.stdout).filter(
          (extension) => extension.status === "failed",
        );

  const actions: RecapEntry[] = [
    ...pending.flatMap((extension) =>
      extension.status === "upgraded" &&
      !failed.some((other) => other.name === extension.name)
        ? [
            notable(
              `Upgraded gh ${extension.name} from ${extension.from} to ${extension.to}`,
            ),
          ]
        : [],
    ),
    ...failed.map((extension) =>
      warn(`Could not upgrade gh ${extension.name}: ${extension.reason}`),
    ),
  ];

  if (actions.length === 0)
    actions.push(skip("gh extensions already up to date"));

  return {
    actions,
    ...(failure !== null && {
      error: `gh extension upgrade exited ${failure.exitCode}`,
    }),
  } satisfies StageOutcome;
});

/** Optional extra folders for `dot up clean`, with how old their files must be. */
const CLEAN_CONFIG = join(CONFIG_DIR, "dot", "clean.yml");

const CleanConfig = Schema.Struct({
  folders: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        olderThan: Schema.DurationFromString,
      }),
    ),
  ),
});

const readCleanConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(CLEAN_CONFIG))) return [];

  const config = yield* fs.readFileString(CLEAN_CONFIG).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap((parsed) =>
      Schema.decodeUnknownEffect(CleanConfig)(parsed, {
        onExcessProperty: "error",
      }),
    ),
    Effect.mapError(
      (error) =>
        new StageError({ message: `${CLEAN_CONFIG}: ${String(error)}` }),
    ),
  );

  return config.folders ?? [];
}).pipe(Effect.withSpan("UpStage.readCleanConfig"));

const formatBytes = (bytes: number) => {
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }

  return `${unit > 0 && value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

/** Disks above this percentage full get a warning from `dot up clean`. */
const DISK_WARN_PERCENT = 95;

/**
 * Free space without sudo: prune mise, remove files unchanged for 30 days
 * from the cache and the folders in `~/.config/dot/clean.yml`, leaving the
 * folders, then warn about any disk over 95% full.
 */
const cleanStage = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const actions: RecapEntry[] = [];
  let freed = 0;

  const miseData = join(DATA_DIR, "mise");

  const directoryBytes = executor.run("du", ["-sb", miseData]).pipe(
    Effect.map((output) => Number(output.split("\t")[0]) || 0),
    Effect.orElseSucceed(() => 0),
  );

  const miseBefore = yield* directoryBytes;
  const pruned = yield* executor.exitCode("mise", ["prune", "--yes"]);
  const miseFreed = Math.max(0, miseBefore - (yield* directoryBytes));

  freed += miseFreed;

  actions.push(
    pruned !== 0
      ? warn(`mise prune exited ${pruned}`)
      : miseFreed > 0
        ? done(`Pruned old mise versions (${formatBytes(miseFreed)})`)
        : skip("No mise versions to prune"),
  );

  const targets = [
    { path: CACHE_DIR, olderThan: Duration.days(30) },
    ...(yield* readCleanConfig),
  ];

  for (const target of targets) {
    const path = expandHomePath(target.path);
    const minutes = Math.floor(Duration.toMillis(target.olderThan) / 60_000);

    // -type f leaves the folders, -xdev stays on one disk, and without -L
    // symlinks aren't followed. A permission error still reports what went.
    const output = yield* executor
      .run("find", [
        path,
        "-xdev",
        "-type",
        "f",
        "-mmin",
        `+${minutes}`,
        "-printf",
        "%s\\n",
        "-delete",
      ])
      .pipe(
        Effect.catchTag("CommandError", (error) =>
          Effect.succeed(error.stdout ?? ""),
        ),
      );

    const sizes = output
      .split("\n")
      .filter(Boolean)
      .map((size) => Number(size) || 0);

    const bytes = sizes.reduce((total, size) => total + size, 0);

    freed += bytes;

    actions.push(
      sizes.length > 0
        ? done(
            `Removed ${plural(sizes.length, "file")} older than ${Duration.format(target.olderThan)} from ${displayPath(path)} (${formatBytes(bytes)})`,
          )
        : skip(
            `No files older than ${Duration.format(target.olderThan)} in ${displayPath(path)}`,
          ),
    );
  }

  actions.push(
    freed > 0
      ? notable(`Freed ${formatBytes(freed)}`)
      : skip("Nothing to clean"),
  );

  const disks = yield* executor
    .run("df", [
      "--output=pcent,target",
      "-x",
      "tmpfs",
      "-x",
      "devtmpfs",
      "-x",
      "squashfs",
      "-x",
      "overlay",
      "-x",
      "efivarfs",
    ])
    .pipe(Effect.orElseSucceed(() => ""));

  for (const [, percent = "0", target = ""] of disks.matchAll(
    /^\s*(\d+)%\s+(.+)$/gm,
  ))
    if (Number(percent) > DISK_WARN_PERCENT)
      actions.push(warn(`${target} is ${percent}% full`));

  return { actions } satisfies StageOutcome;
});

/** Restore Herdr's pinned plugins and sync the saved Herdr and hc machines. */
const herdrStage = Effect.gen(function* () {
  return {
    actions: [
      yield* restoreHerdrPlugins,
      yield* syncHerdrMachines,
      yield* syncHcMachines,
    ],
  } satisfies StageOutcome;
});

const agentsStage = (reload: boolean) =>
  Effect.gen(function* () {
    yield* agentsSync;

    return {
      actions: [
        done("Synced agent instructions"),
        yield* syncNotesRepositoryDirectories,
        reload
          ? yield* reloadAgents
          : skip("Agent reload skipped (nothing changed)"),
      ],
    } satisfies StageOutcome;
  });

const stageEffect = (stage: UpStage, opts: UpStageOptions) =>
  Effect.gen(function* () {
    switch (stage) {
      case "dotfiles":
        return yield* dotfilesStage;
      case "skills":
        return yield* skillsStage;
      case "repos":
        return yield* reposStage(opts.repos ?? []);
      case "stow":
        return yield* stowStage;
      case "plugins":
        return yield* pluginsStage;
      case "herdr":
        return yield* herdrStage;
      case "agents":
        return yield* agentsStage(opts.reload ?? true);
      case "gh":
        return yield* ghStage;
      case "clean":
        return yield* cleanStage;
    }
  });

/** Run one stage, turning a failure into a failed result. */
export const runUpStage = Effect.fn("UpStage.run")(function* (
  stage: UpStage,
  opts: UpStageOptions = {},
) {
  const log = yield* OutputLog;

  const outcome: StageOutcome & { readonly error?: string } =
    yield* stageEffect(stage, opts).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const message = formatCause(cause);
          yield* log.error(`${stage} failed: ${message}`);

          return { actions: [warn(`${stage} failed`)], error: message };
        }),
      ),
    );

  const updatedRepos = outcome.updatedRepos ?? [];

  return {
    stage,
    changed: changedBy(outcome.actions) || updatedRepos.length > 0,
    failed: outcome.error !== undefined,
    ...(outcome.error !== undefined && { error: outcome.error }),
    actions: outcome.actions,
    updatedRepos,
    miseTools: outcome.miseTools ?? [],
    skillsChanged: outcome.skillsChanged ?? false,
    pluginsChanged: outcome.pluginsChanged ?? false,
    restartNeeded: outcome.restartNeeded ?? false,
  } satisfies UpStageResult;
});

/**
 * `dot up <stage>`: run one stage headless, then print its result as JSON or
 * as the usual summary followed by `dot up --check`. A failed stage exits 1.
 */
export const upStage = Effect.fn("UpStage.command")(function* (
  stage: UpStage,
  opts: UpStageOptions & { readonly json: boolean },
) {
  const log = yield* OutputLog;
  const startedAt = yield* Clock.currentTimeMillis;

  yield* log.section(`Up ${stage.charAt(0).toUpperCase()}${stage.slice(1)}`);

  const result = yield* runUpStage(stage, opts);

  if (result.failed) process.exitCode = 1;

  if (opts.json) {
    printJson(JSON.stringify(result, null, 2));

    return;
  }

  yield* logUpdateSummary(
    result.updatedRepos,
    result.miseTools,
    result.actions,
    startedAt,
  );
  yield* reportPendingUpdates;
});
