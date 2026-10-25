import { HerdrSdk, herdrSdkLayerFromOptions } from "@timmo001/effect-herdr";
import { Cause, Duration, Effect, Option } from "effect";
import { basename, join } from "path";
import { isAgent } from "../lib/agent.js";
import { ENV, envString } from "../lib/env.js";
import { pathExists } from "../lib/fsProbe.js";
import {
  gitCurrentBranch,
  gitExitCode,
  gitOutput,
  gitPullFastForward,
  gitRemoteOutput,
} from "../lib/git.js";
import { DATA_DIR, displayPath } from "../lib/paths.js";
import { formatCause } from "../lib/schema.js";
import { skip, warn, notable } from "../lib/updateSummary.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { DEFAULT_SOCKET_PATH, openHerdrRepo } from "./HerdrRepoOpen.js";

const DESKTOP_BRANCH = "distro/arch-omarchy-quattro";

const SERVER_BRANCH = "distro/ubuntu-server";

/**
 * Distro diff page the bot regenerates after every push. Commits that only
 * touch it don't make a branch behind, or every push would ask for a rebase.
 */
const GENERATED_PAGE = "docs/src/content/docs/server/changes.md";

/** A branch built on the server branch, kept in its own permanent worktree. */
interface ServerChild {
  /** Git branch name. */
  readonly branch: string;
  /** Permanent worktree holding the branch. */
  readonly worktree: string;
  /** How the agent should rebase it, after fetching in its worktree. */
  readonly steps: string;
}

/** Branches that rebase onto the server branch, in the order to rebase them. */
const SERVER_CHILDREN: readonly ServerChild[] = [
  {
    branch: "distro/cloud",
    worktree: join(DATA_DIR, "dot", "dotfiles-cloud"),
    steps: `follow "Updating From The Server Branch" in that worktree's AGENTS.md.`,
  },
  {
    branch: "distro/opencode-app",
    worktree: join(DATA_DIR, "dot", "dotfiles-opencode-app"),
    steps: `follow "Updating From The Desktop Branch" in ${SERVER_BRANCH}'s AGENTS.md against origin/${SERVER_BRANCH}, sorting changes with the "OpenCode App Branch" section of that worktree's AGENTS.md: it takes what the server takes apart from NAS machine setup, and conflicts keep the app side. The branch is still being worked on, so check \`git status\` and the commits on it first, and ask before touching anything unfinished.`,
  },
];

/** Herdr agent name that marks a branch update agent as already running. */
const AGENT_NAME = "branch-update";

const FETCH_TIMEOUT = Duration.seconds(30);

/** Whether `ref` lacks commits from `upstream` beyond the generated page. */
const behind = (repo: string, upstream: string, ref: string) =>
  gitOutput(
    [
      "rev-list",
      "--count",
      upstream,
      `^${ref}`,
      "--",
      ".",
      `:(exclude)${GENERATED_PAGE}`,
    ],
    { cwd: repo },
  ).pipe(Effect.map((count) => Number(count.trim()) > 0));

/** Whether a rebase is stopped part-way in this checkout or worktree. */
const rebaseInProgress = Effect.fn("BranchUpdate.rebaseInProgress")(function* (
  checkout: string,
) {
  if (!(yield* pathExists(checkout))) return false;

  for (const name of ["rebase-merge", "rebase-apply"]) {
    const path = (yield* gitOutput(["rev-parse", "--git-path", name], {
      cwd: checkout,
    })).trim();

    if (yield* pathExists(path.startsWith("/") ? path : join(checkout, path)))
      return true;
  }

  return false;
});

/** Create a child's worktree when missing, otherwise follow its upstream. */
const ensureWorktree = Effect.fn("BranchUpdate.ensureWorktree")(function* (
  repo: string,
  { branch, worktree }: ServerChild,
) {
  const log = yield* OutputLog;

  if (yield* pathExists(worktree)) {
    if (yield* rebaseInProgress(worktree)) return;

    if (!(yield* gitPullFastForward(worktree)))
      yield* log.warn(
        `Could not fast-forward ${displayPath(worktree)}; leaving it as it is`,
      );

    return;
  }

  yield* gitOutput(["worktree", "prune"], { cwd: repo });

  const localBranch =
    (yield* gitExitCode(
      ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
      { cwd: repo },
    )) === 0;

  yield* gitOutput(
    localBranch
      ? ["worktree", "add", worktree, branch]
      : [
          "worktree",
          "add",
          "--track",
          "-b",
          branch,
          worktree,
          `origin/${branch}`,
        ],
    { cwd: repo },
  );
  yield* log.success(
    `Created the ${branch} worktree at ${displayPath(worktree)}`,
  );
});

const agentPrompt = (
  repo: string,
  serverBehind: boolean,
  children: readonly ServerChild[],
) =>
  [
    "The dotfiles distro branches are behind. Rebase them.",
    [
      ...(serverBehind
        ? [
            `In ${repo} (${SERVER_BRANCH}), follow "Updating From The Desktop Branch" in AGENTS.md to rebase onto origin/${DESKTOP_BRANCH}.`,
          ]
        : []),
      ...children.map(
        ({ branch, worktree, steps }) =>
          `In ${worktree} (${branch}, a permanent worktree of the same repository), fetch, then ${steps} Rebase with \`git rebase --fork-point origin/${SERVER_BRANCH}\` so only its own commits replay when the server branch was force-pushed.`,
      ),
      `Run \`dot update\` in ${repo} to apply the result.`,
    ]
      .map((step, index) => `${index + 1}. ${step}`)
      .join("\n"),
    `Commits that only regenerate \`${GENERATED_PAGE}\` don't need a rebase of their own: the Distro diff workflow adds one after every push.`,
    "This prompt is the request to commit the rebase follow-ups through `dot git commit` and to push each branch with `git push --force-with-lease` once its checks pass. Keep any existing user changes intact. If a change can't be sorted into wanted or not wanted from AGENTS.md, stop and ask instead of guessing.",
  ].join("\n\n");

/** Open an OpenCode agent in Herdr to rebase the branches, unless one is already running. */
const openBranchAgent = Effect.fn("BranchUpdate.openAgent")(function* (
  repo: string,
  serverBehind: boolean,
  children: readonly ServerChild[],
) {
  const herdr = yield* HerdrSdk;

  const running = (yield* herdr.agents.list()).some(
    (agent) => Option.getOrUndefined(agent.name) === AGENT_NAME,
  );

  if (running) return false;

  yield* openHerdrRepo({
    label: basename(repo),
    directory: repo,
    layout: "vertical",
    agent: "opencode2",
    agentName: AGENT_NAME,
    prompt: agentPrompt(repo, serverBehind, children),
  });

  return true;
});

/**
 * Hand the server branch and the branches built on it to an agent when the
 * branch below has moved past them. Runs only on the server branch and opens
 * at most one agent; returns the recap entry for the update summary.
 */
export const branchUpdate = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;
  const repo = config.publicDotfiles;

  yield* log.section("Branch Update");

  const branch = yield* gitCurrentBranch(repo);

  if (branch !== SERVER_BRANCH) {
    yield* log.info(`Not on ${SERVER_BRANCH}; skipping`);

    return skip(`Branch update skipped (not on ${SERVER_BRANCH})`);
  }

  yield* gitRemoteOutput(
    [
      "fetch",
      "--quiet",
      "origin",
      DESKTOP_BRANCH,
      SERVER_BRANCH,
      ...SERVER_CHILDREN.map((child) => child.branch),
    ],
    { cwd: repo },
    FETCH_TIMEOUT,
  );

  for (const child of SERVER_CHILDREN) yield* ensureWorktree(repo, child);

  const serverBehind = yield* behind(
    repo,
    `origin/${DESKTOP_BRANCH}`,
    `origin/${SERVER_BRANCH}`,
  );

  const childrenBehind = yield* Effect.filter(SERVER_CHILDREN, (child) =>
    behind(repo, `origin/${SERVER_BRANCH}`, `origin/${child.branch}`),
  );

  if (!serverBehind && childrenBehind.length === 0) {
    yield* log.success("Distro branches are up to date");

    return skip("Distro branches already up to date");
  }

  // A server rebase moves the base of every child, so they all follow it.
  const children = serverBehind ? SERVER_CHILDREN : childrenBehind;

  const summary = [
    ...(serverBehind ? [`${SERVER_BRANCH} is behind ${DESKTOP_BRANCH}`] : []),
    ...childrenBehind.map(
      (child) => `${child.branch} is behind ${SERVER_BRANCH}`,
    ),
  ].join(", ");

  yield* log.info(summary);

  const rebasing = yield* Effect.filter(
    [repo, ...SERVER_CHILDREN.map((child) => child.worktree)],
    (checkout) => rebaseInProgress(checkout),
  );

  if (rebasing.length > 0) {
    yield* log.warn("A rebase is already in progress; leaving it to finish");

    return warn(`${summary}; a rebase is already in progress`);
  }

  if (isAgent()) {
    yield* log.warn("Running under an agent; not opening another one");

    return warn(`${summary}; rebase not started under an agent`);
  }

  const opened = yield* openBranchAgent(repo, serverBehind, children).pipe(
    Effect.provide(
      herdrSdkLayerFromOptions({
        socketPath: envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH,
        requestTimeout: Duration.seconds(5),
      }),
    ),
  );

  if (!opened) {
    yield* log.info(`The ${AGENT_NAME} agent is already open in Herdr`);

    return skip(`${summary}; the ${AGENT_NAME} agent is already open`);
  }

  yield* log.success(`Opened the ${AGENT_NAME} agent in Herdr to rebase`);

  return notable(`Opened an agent to rebase: ${summary}`);
}).pipe(
  Effect.catchCause((cause) =>
    Effect.gen(function* () {
      const log = yield* OutputLog;
      const message = `Branch update failed: ${formatCause(Cause.squash(cause))}`;

      yield* log.warn(message);

      return warn(message);
    }),
  ),
  Effect.withSpan("BranchUpdate.run"),
);
