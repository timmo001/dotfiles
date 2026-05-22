import { Effect } from "effect";
import { existsSync } from "fs";
import { join } from "path";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;

function displayPath(p: string): string {
  return p.replace(HOME, "~");
}

/** Map repo name to expected GitHub org/repo slug (matches legacy omarchy_repo_slug) */
function omarchyRepoSlug(repoName: string): string | null {
  switch (repoName) {
    case "bootstrap":
      return "timmo001/bootstrap";
    case "hypr":
      return "timmo001/omarchy-hypr";
    case "waybar":
      return "timmo001/omarchy-waybar";
    case "ghostty":
      return "timmo001/omarchy-ghostty";
    case "uwsm":
      return "timmo001/omarchy-uwsm";
    default:
      return null;
  }
}

/** Single-branch repos that should not have worktree checks */
const SINGLE_BRANCH_REPOS = new Set(["bootstrap", "waybar", "ghostty", "uwsm"]);

/** Check omarchy diff repos exist with correct remotes and worktree branches */
export const checkOmarchy = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  if (!config.omarchy.enabled) {
    results.push({
      severity: "ok",
      message: "Omarchy diff repos are disabled",
    });
    return results;
  }

  const repoBase = config.omarchy.repoBase;

  // Check each diff repo exists and has correct remote
  for (const repoName of config.omarchy.diffRepos) {
    const repoPath = join(repoBase, repoName);

    if (!existsSync(join(repoPath, ".git"))) {
      results.push({
        severity: "warn",
        message: `Missing git repo ${displayPath(repoPath)}`,
      });
      continue;
    }

    results.push({ severity: "ok", message: `Found ${displayPath(repoPath)}` });

    // Check remote matches expected slug pattern
    const remoteResult = yield* executor
      .run("git", ["-C", repoPath, "remote", "get-url", "origin"])
      .pipe(Effect.catch(() => Effect.succeed("")));
    const remote = remoteResult.trim();
    const slug = omarchyRepoSlug(repoName);

    if (remote && slug && remote.includes(slug)) {
      results.push({
        severity: "ok",
        message: `Remote OK for ${repoName} (${slug})`,
      });
    } else if (remote && slug) {
      results.push({
        severity: "warn",
        message: `Remote mismatch for ${repoName} (expected ${slug})`,
      });
    } else if (remote) {
      results.push({ severity: "ok", message: `Remote OK for ${repoName}` });
    } else {
      results.push({
        severity: "warn",
        message: `Remote mismatch for ${repoName}`,
      });
    }
  }

  // Check worktree branches — report single-branch repos as skipped
  for (const repoName of config.omarchy.diffRepos) {
    const repoPath = join(repoBase, repoName);

    // Single-branch repos don't have worktrees
    if (SINGLE_BRANCH_REPOS.has(repoName)) {
      if (!config.omarchy.worktreeRepos.includes(repoName)) {
        results.push({
          severity: "ok",
          message: `Skipping branch checks for ${repoName} (single-branch repo)`,
        });
      }
      continue;
    }

    // Only process repos that are in the worktreeRepos list
    if (!config.omarchy.worktreeRepos.includes(repoName)) continue;

    const isGit = yield* executor.exitCode("git", [
      "-C",
      repoPath,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    if (isGit !== 0) {
      results.push({
        severity: "warn",
        message: `Skipping worktree checks for ${repoName} (base repo missing): ${displayPath(repoPath)}`,
      });
      continue;
    }

    // Get current branch of main worktree
    const currentBranchResult = yield* executor
      .run("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"])
      .pipe(Effect.catch(() => Effect.succeed("")));
    const currentBranch = currentBranchResult.trim();

    for (const branchName of config.omarchy.worktreeBranches) {
      // Skip if this IS the current branch
      if (branchName === currentBranch) continue;

      // Check if branch ref exists
      const branchExists = yield* executor.exitCode("git", [
        "-C",
        repoPath,
        "rev-parse",
        "--verify",
        `refs/heads/${branchName}`,
      ]);
      if (branchExists !== 0) {
        results.push({
          severity: "ok",
          message: `Skipping ${repoName}-${branchName} check (branch '${branchName}' not found)`,
        });
        continue;
      }

      const worktreePath = join(repoBase, `${repoName}-${branchName}`);
      const worktreeIsGit = yield* executor.exitCode("git", [
        "-C",
        worktreePath,
        "rev-parse",
        "--is-inside-work-tree",
      ]);

      if (worktreeIsGit === 0) {
        const wtBranchResult = yield* executor
          .run("git", ["-C", worktreePath, "rev-parse", "--abbrev-ref", "HEAD"])
          .pipe(Effect.catch(() => Effect.succeed("")));
        const wtBranch = wtBranchResult.trim();

        if (wtBranch === branchName) {
          results.push({
            severity: "ok",
            message: `Found ${displayPath(worktreePath)} (branch '${branchName}')`,
          });
        } else {
          results.push({
            severity: "warn",
            message: `Worktree branch mismatch for ${displayPath(worktreePath)} (expected '${branchName}', found '${wtBranch}')`,
          });
        }
      } else {
        results.push({
          severity: "warn",
          message: `Missing worktree ${displayPath(worktreePath)} for branch '${branchName}'`,
        });
      }
    }
  }

  return results;
});
