import { Effect } from "effect";
import { existsSync, lstatSync, readlinkSync } from "fs";
import { dirname, join } from "path";
import { Config } from "../../services/Config.js";
import type { CheckResult } from "../types.js";
import { readGitBranch, readGitUpstream, upstreamBranch } from "../git.js";
import { gitExitCode, gitOutput, isGitRepo } from "../../lib/git.js";
import { displayPath } from "../../lib/paths.js";
import {
  currentOmarchyHost,
  hyprRepoPath,
  resolveLinkTarget,
} from "../../lib/omarchyHost.js";
import type { ConfigService } from "../../services/Config.js";

/** Map repo name to expected GitHub org/repo slug (matches legacy omarchy_repo_slug) */
function omarchyRepoSlug(repoName: string): string | null {
  switch (repoName) {
    case "bootstrap":
      return "timmo001/bootstrap";
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

function isNamedBranch(branch: string): boolean {
  return branch !== "" && branch !== "HEAD";
}

function remoteResult(repoName: string, remote: string): CheckResult {
  const slug = omarchyRepoSlug(repoName);

  if (!remote) {
    return { severity: "warn", message: `Remote mismatch for ${repoName}` };
  }

  if (!slug) {
    return { severity: "ok", message: `Remote OK for ${repoName}` };
  }

  if (remote.includes(slug)) {
    return {
      severity: "ok",
      message: `Remote OK for ${repoName} (${slug})`,
    };
  }

  return {
    severity: "warn",
    message: `Remote mismatch for ${repoName} (expected ${slug})`,
  };
}

function branchResults(
  repoName: string,
  branch: string,
  expectedBranch: string | undefined,
): CheckResult[] {
  if (!isNamedBranch(branch)) {
    return [
      { severity: "warn", message: `${repoName} is not on a named branch` },
    ];
  }

  if (!expectedBranch) return [];

  if (branch === expectedBranch) {
    return [{ severity: "ok", message: `${repoName} branch OK ('${branch}')` }];
  }

  return [
    {
      severity: "warn",
      message: `${repoName} branch mismatch (expected '${expectedBranch}', found '${branch}')`,
    },
  ];
}

function upstreamResult(
  repoName: string,
  branch: string,
  upstream: string,
  expectedBranch: string | undefined,
): CheckResult {
  if (!upstream) {
    return {
      severity: "warn",
      message: `${repoName} branch '${branchNameOrUnknown(branch)}' has no upstream`,
    };
  }

  if (expectedBranch) {
    if (upstreamBranch(upstream) !== expectedBranch) {
      return {
        severity: "warn",
        message: `${repoName} upstream mismatch (expected '${expectedBranch}', found '${upstream}')`,
      };
    }
  }

  return {
    severity: "ok",
    message: `${repoName} upstream OK ('${upstream}')`,
  };
}

function branchNameOrUnknown(branch: string): string {
  return branch === "" ? "unknown" : branch;
}

function checkHyprHostLink(
  hostLink: string,
  hostDir: string,
  host: string,
): CheckResult {
  try {
    const stat = lstatSync(hostLink);
    if (!stat.isSymbolicLink()) {
      return {
        severity: "warn",
        message: `${displayPath(hostLink)} exists but is not a symlink`,
      };
    }

    const target = resolveLinkTarget(hostLink, readlinkSync(hostLink));
    if (target === hostDir) {
      return {
        severity: "ok",
        message: `Hypr host link OK (${displayPath(hostLink)} -> hosts/${host})`,
      };
    }

    return {
      severity: "warn",
      message: `Hypr host link mismatch (expected hosts/${host}, found ${displayPath(target)})`,
    };
  } catch {
    return {
      severity: "warn",
      message: `Missing Hypr host link ${displayPath(hostLink)} (run: dot stow)`,
    };
  }
}

function checkHyprHost(config: ConfigService): CheckResult[] {
  const host = currentOmarchyHost();
  if (!host) {
    return [
      {
        severity: "warn",
        message: "OMARCHY_HOST is not set — cannot check Hypr host link",
      },
    ];
  }

  const repoPath = hyprRepoPath(config);
  const hostDir = join(repoPath, "hosts", host);
  const hostLink = join(repoPath, "host");

  if (!existsSync(hostDir)) {
    return [
      {
        severity: "warn",
        message: `Missing Hypr host config ${displayPath(hostDir)}`,
      },
    ];
  }

  return [checkHyprHostLink(hostLink, hostDir, host)];
}

const checkOmarchyRepo = (config: ConfigService, repoName: string) =>
  Effect.gen(function* () {
    const repoPath = join(config.omarchy.repoBase, repoName);
    if (!isGitRepo(repoPath)) {
      return [
        {
          severity: "warn",
          message: `Missing git repo ${displayPath(repoPath)}`,
        },
      ] satisfies CheckResult[];
    }

    const remote = (yield* gitOutput(["remote", "get-url", "origin"], {
      cwd: repoPath,
    }).pipe(Effect.catch(() => Effect.succeed("")))).trim();
    const branch = yield* readGitBranch(repoPath);
    const upstream = yield* readGitUpstream(repoPath);
    const expectedBranch = config.omarchy.expectedBranches[repoName];

    return [
      { severity: "ok", message: `Found ${displayPath(repoPath)}` },
      remoteResult(repoName, remote),
      ...branchResults(repoName, branch, expectedBranch),
      upstreamResult(repoName, branch, upstream, expectedBranch),
    ] satisfies CheckResult[];
  });

const checkWorktreeBranch = (
  repoPath: string,
  repoName: string,
  branchName: string,
) =>
  Effect.gen(function* () {
    const branchExists = yield* gitExitCode(
      ["rev-parse", "--verify", `refs/heads/${branchName}`],
      { cwd: repoPath },
    );
    if (branchExists !== 0) {
      return [
        {
          severity: "ok",
          message: `Skipping ${repoName}-${branchName} check (branch '${branchName}' not found)`,
        },
      ] satisfies CheckResult[];
    }

    const worktreePath = join(dirname(repoPath), `${repoName}-${branchName}`);
    const worktreeIsGit = yield* gitExitCode(
      ["rev-parse", "--is-inside-work-tree"],
      { cwd: worktreePath },
    );
    if (worktreeIsGit !== 0) {
      return [
        {
          severity: "warn",
          message: `Missing worktree ${displayPath(worktreePath)} for branch '${branchName}'`,
        },
      ] satisfies CheckResult[];
    }

    const wtBranch = yield* readGitBranch(worktreePath);
    return [
      wtBranch === branchName
        ? {
            severity: "ok",
            message: `Found ${displayPath(worktreePath)} (branch '${branchName}')`,
          }
        : {
            severity: "warn",
            message: `Worktree branch mismatch for ${displayPath(worktreePath)} (expected '${branchName}', found '${wtBranch}')`,
          },
    ] satisfies CheckResult[];
  });

const checkOmarchyWorktrees = (config: ConfigService, repoName: string) =>
  Effect.gen(function* () {
    if (!config.omarchy.worktreeRepos.includes(repoName)) {
      return [
        {
          severity: "ok",
          message: `Skipping worktree checks for ${repoName} (single-branch repo)`,
        },
      ] satisfies CheckResult[];
    }

    const repoPath = join(config.omarchy.repoBase, repoName);
    const isGit = yield* gitExitCode(["rev-parse", "--is-inside-work-tree"], {
      cwd: repoPath,
    });
    if (isGit !== 0) {
      return [
        {
          severity: "warn",
          message: `Skipping worktree checks for ${repoName} (base repo missing): ${displayPath(repoPath)}`,
        },
      ] satisfies CheckResult[];
    }

    const results: CheckResult[] = [];
    const currentBranch = yield* readGitBranch(repoPath);
    const branchNames = config.omarchy.worktreeBranches.filter(
      (branchName) => branchName !== currentBranch,
    );

    for (const branchName of branchNames) {
      results.push(
        ...(yield* checkWorktreeBranch(repoPath, repoName, branchName)),
      );
    }

    return results;
  });

/** Check Omarchy diff repos, expected branches, and Hypr host-link state */
export const checkOmarchy = Effect.gen(function* () {
  const config = yield* Config;
  const results: CheckResult[] = [];

  if (!config.omarchy.enabled) {
    return [
      { severity: "ok", message: "Omarchy diff repos are disabled" },
    ] satisfies CheckResult[];
  }

  for (const repoName of config.omarchy.diffRepos) {
    results.push(...(yield* checkOmarchyRepo(config, repoName)));
  }

  for (const repoName of config.omarchy.diffRepos) {
    results.push(...(yield* checkOmarchyWorktrees(config, repoName)));
  }

  results.push(...checkHyprHost(config));
  return results;
});
