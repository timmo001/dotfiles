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

const CLOUD_BRANCH = "distro/cloud";

/** Permanent worktree of the public dotfiles holding the cloud branch. */
export const CLOUD_WORKTREE = join(DATA_DIR, "dot", "dotfiles-cloud");

/** Herdr agent name that marks a branch update agent as already running. */
const AGENT_NAME = "branch-update";

const FETCH_TIMEOUT = Duration.seconds(30);

/** Whether `ancestor` is already contained in `ref`. */
const contains = (repo: string, ancestor: string, ref: string) =>
  gitExitCode(["merge-base", "--is-ancestor", ancestor, ref], {
    cwd: repo,
  }).pipe(Effect.map((code) => code === 0));

/** Whether a rebase is stopped part-way in this checkout or worktree. */
const rebaseInProgress = Effect.fn("BranchUpdate.rebaseInProgress")(function* (
  checkout: string,
) {
  for (const name of ["rebase-merge", "rebase-apply"]) {
    const path = (yield* gitOutput(["rev-parse", "--git-path", name], {
      cwd: checkout,
    })).trim();

    if (yield* pathExists(path.startsWith("/") ? path : join(checkout, path)))
      return true;
  }

  return false;
});

/** Create the cloud worktree when missing, otherwise follow its upstream. */
const ensureCloudWorktree = Effect.fn("BranchUpdate.ensureCloudWorktree")(
  function* (repo: string) {
    const log = yield* OutputLog;

    if (yield* pathExists(CLOUD_WORKTREE)) {
      if (yield* rebaseInProgress(CLOUD_WORKTREE)) return;

      if (!(yield* gitPullFastForward(CLOUD_WORKTREE)))
        yield* log.warn(
          `Could not fast-forward ${displayPath(CLOUD_WORKTREE)}; leaving it as it is`,
        );

      return;
    }

    yield* gitOutput(["worktree", "prune"], { cwd: repo });

    const localBranch =
      (yield* gitExitCode(
        ["rev-parse", "--verify", "--quiet", `refs/heads/${CLOUD_BRANCH}`],
        { cwd: repo },
      )) === 0;

    yield* gitOutput(
      localBranch
        ? ["worktree", "add", CLOUD_WORKTREE, CLOUD_BRANCH]
        : [
            "worktree",
            "add",
            "--track",
            "-b",
            CLOUD_BRANCH,
            CLOUD_WORKTREE,
            `origin/${CLOUD_BRANCH}`,
          ],
      { cwd: repo },
    );
    yield* log.success(
      `Created the ${CLOUD_BRANCH} worktree at ${displayPath(CLOUD_WORKTREE)}`,
    );
  },
);

const agentPrompt = (repo: string, serverBehind: boolean) =>
  [
    "The server and cloud dotfiles branches are behind. Rebase them.",
    [
      ...(serverBehind
        ? [
            `In ${repo} (${SERVER_BRANCH}), follow "Updating From The Desktop Branch" in AGENTS.md to rebase onto origin/${DESKTOP_BRANCH}.`,
          ]
        : []),
      `In ${CLOUD_WORKTREE} (${CLOUD_BRANCH}, a permanent worktree of the same repository), fetch, then follow "Updating From The Server Branch" in that worktree's AGENTS.md to rebase onto origin/${SERVER_BRANCH}.`,
      `Run \`dot update\` in ${repo} to apply the result.`,
    ]
      .map((step, index) => `${index + 1}. ${step}`)
      .join("\n"),
    "This prompt is the request to commit the rebase follow-ups through `dot git commit` and to push each branch with `git push --force-with-lease` once its checks pass. Keep any existing user changes intact. If a change can't be sorted into wanted or not wanted from AGENTS.md, stop and ask instead of guessing.",
  ].join("\n\n");

/** Open an OpenCode agent in Herdr to rebase the branches, unless one is already running. */
const openBranchAgent = Effect.fn("BranchUpdate.openAgent")(function* (
  repo: string,
  serverBehind: boolean,
) {
  const herdr = yield* HerdrSdk;

  const running = (yield* herdr.agents.list()).some(
    (agent) => Option.getOrUndefined(agent.name) === AGENT_NAME,
  );

  if (running) return false;

  yield* openHerdrRepo({
    label: basename(repo),
    directory: repo,
    layout: "tab",
    agent: "opencode2",
    agentName: AGENT_NAME,
    prompt: agentPrompt(repo, serverBehind),
  });

  return true;
});

/**
 * Hand the server and cloud branch rebases to an agent when the desktop or
 * server branch has moved past them. Runs only on the server branch and opens
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
    ["fetch", "--quiet", "origin", DESKTOP_BRANCH, SERVER_BRANCH, CLOUD_BRANCH],
    { cwd: repo },
    FETCH_TIMEOUT,
  );
  yield* ensureCloudWorktree(repo);

  const serverBehind = !(yield* contains(
    repo,
    `origin/${DESKTOP_BRANCH}`,
    `origin/${SERVER_BRANCH}`,
  ));

  const cloudBehind = !(yield* contains(
    repo,
    `origin/${SERVER_BRANCH}`,
    `origin/${CLOUD_BRANCH}`,
  ));

  if (!serverBehind && !cloudBehind) {
    yield* log.success("Server and cloud branches are up to date");

    return skip("Server and cloud branches already up to date");
  }

  const behind = serverBehind
    ? `${SERVER_BRANCH} is behind ${DESKTOP_BRANCH}`
    : `${CLOUD_BRANCH} is behind ${SERVER_BRANCH}`;

  yield* log.info(behind);

  if (
    (yield* rebaseInProgress(repo)) ||
    (yield* rebaseInProgress(CLOUD_WORKTREE))
  ) {
    yield* log.warn("A rebase is already in progress; leaving it to finish");

    return warn(`${behind}; a rebase is already in progress`);
  }

  if (isAgent()) {
    yield* log.warn("Running under an agent; not opening another one");

    return warn(`${behind}; rebase not started under an agent`);
  }

  const opened = yield* openBranchAgent(repo, serverBehind).pipe(
    Effect.provide(
      herdrSdkLayerFromOptions({
        socketPath: envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH,
        requestTimeout: Duration.seconds(5),
      }),
    ),
  );

  if (!opened) {
    yield* log.info(`The ${AGENT_NAME} agent is already open in Herdr`);

    return skip(`${behind}; the ${AGENT_NAME} agent is already open`);
  }

  yield* log.success(`Opened the ${AGENT_NAME} agent in Herdr to rebase`);

  return notable(`Opened an agent to rebase: ${behind}`);
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
