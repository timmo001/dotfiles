import { Effect } from "effect";
import { existsSync } from "fs";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { managedGitRepos } from "../../services/GitConfig.js";
import { gitOutput, isGitRepo } from "../../lib/git.js";
import { HOME_DIR, displayPath } from "../../lib/paths.js";
import type { CheckResult } from "../../doctor/types.js";

/** Remote whose HEAD symbolic-ref drives default-branch detection. */
const REMOTE = "origin";

/** A managed checkout to inspect for a stale `origin/HEAD`. */
interface RepoTarget {
  readonly label: string;
  readonly path: string;
}

/** Run a git command in a repo, returning trimmed stdout or "" on any failure. */
function tryGit(
  args: readonly string[],
  cwd: string,
): Effect.Effect<string, never, CommandExecutor> {
  return gitOutput(args, { cwd }).pipe(
    Effect.map((output) => output.trim()),
    Effect.catch(() => Effect.succeed("")),
  );
}

/**
 * Parse the local `refs/remotes/<remote>/HEAD` symbolic-ref target into a
 * branch name. Returns "" when the ref is unset or does not match the expected
 * remote prefix.
 */
function parseLocalHeadBranch(symbolicRef: string): string {
  const prefix = `refs/remotes/${REMOTE}/`;
  const trimmed = symbolicRef.trim();
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : "";
}

/**
 * Parse the remote's advertised HEAD from `git ls-remote --symref` output. The
 * symref line looks like `ref: refs/heads/<branch>\tHEAD`; the branch may
 * contain slashes, so split on the tab and strip the `refs/heads/` prefix.
 */
function parseRemoteHeadBranch(lsRemoteOutput: string): string {
  const headsPrefix = "ref: refs/heads/";
  for (const line of lsRemoteOutput.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(headsPrefix)) {
      const [branch = ""] = trimmed.slice(headsPrefix.length).split("\t");
      return branch.trim();
    }
  }
  return "";
}

/**
 * Compare a single repo's local `origin/HEAD` against the remote's advertised
 * default branch. Returns `null` (skip) when the repo is missing, has no
 * `origin`, or the remote cannot be reached — so transient/offline states never
 * surface as failures.
 */
function checkRepoHead(
  target: RepoTarget,
): Effect.Effect<CheckResult | null, never, CommandExecutor> {
  return Effect.gen(function* () {
    if (!existsSync(target.path) || !isGitRepo(target.path)) return null;

    const remoteBranch = parseRemoteHeadBranch(
      yield* tryGit(["ls-remote", "--symref", REMOTE, "HEAD"], target.path),
    );
    // No origin remote, offline, or remote advertises no HEAD: cannot judge.
    if (!remoteBranch) return null;

    const localBranch = parseLocalHeadBranch(
      yield* tryGit(
        ["symbolic-ref", "--quiet", `refs/remotes/${REMOTE}/HEAD`],
        target.path,
      ),
    );

    if (!localBranch) {
      return {
        severity: "warn",
        message: `${target.label}: local ${REMOTE}/HEAD is unset (remote default '${remoteBranch}')`,
        detail: `Run: git -C ${displayPath(target.path)} remote set-head ${REMOTE} --auto`,
      };
    }

    if (localBranch !== remoteBranch) {
      return {
        severity: "warn",
        message: `${target.label}: local ${REMOTE}/HEAD is stale ('${localBranch}', remote default '${remoteBranch}')`,
        detail: `Run: git -C ${displayPath(target.path)} remote set-head ${REMOTE} --auto`,
      };
    }

    return {
      severity: "ok",
      message: `${target.label}: ${REMOTE}/HEAD matches remote default ('${remoteBranch}')`,
    };
  });
}

/**
 * Check that managed checkouts' local `origin/HEAD` symbolic-refs track their
 * remote default branch. A stale ref (e.g. after a default-branch rename)
 * misleads default-branch detection in `dot git-status`, `dot git-log`, and the
 * branch-context plugin, making the default branch look like a feature branch.
 */
export const checkOriginHead = Effect.gen(function* () {
  const config = yield* Config;

  const targets: RepoTarget[] = [
    { label: "Public dotfiles", path: config.publicDotfiles },
    {
      label: "Private dotfiles",
      path: `${HOME_DIR}/.config/dotfiles-private`,
    },
  ];

  if (config.canUsePrivate && config.gitConfig.valid) {
    for (const repo of managedGitRepos(config.gitConfig)) {
      targets.push({ label: `Private git repo ${repo.name}`, path: repo.path });
    }
  }

  const results: CheckResult[] = [];
  for (const target of targets) {
    const result = yield* checkRepoHead(target);
    if (result) results.push(result);
  }

  if (results.length === 0) {
    results.push({
      severity: "ok",
      message: "No reachable repositories to check for stale origin/HEAD",
    });
  }

  return results;
});
