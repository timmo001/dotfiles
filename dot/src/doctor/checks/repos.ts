import { Effect } from "effect";
import { existsSync } from "fs";
import { Config } from "../../services/Config.js";
import { managedGitRepos } from "../../services/GitConfig.js";
import { gitExitCode } from "../../lib/git.js";
import { readGitBranch, readGitUpstream } from "../git.js";
import type { CheckResult } from "../types.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;

/** Display path with ~ for HOME */
function displayPath(p: string): string {
  return p.replace(HOME, "~");
}

/** Check public/private dotfiles repos and private git config repos. */
export const checkRepos = Effect.gen(function* () {
  const config = yield* Config;
  const results: CheckResult[] = [];

  // Public dotfiles
  if (existsSync(config.publicDotfiles)) {
    results.push({
      severity: "ok",
      message: `Found ${displayPath(config.publicDotfiles)}`,
    });
  } else {
    results.push({
      severity: "error",
      message: `Missing ${displayPath(config.publicDotfiles)}`,
    });
  }

  // Private dotfiles
  const privatePath = `${HOME}/.config/dotfiles-private`;
  if (existsSync(privatePath)) {
    results.push({
      severity: "ok",
      message: `Found ${displayPath(privatePath)}`,
    });
  } else {
    results.push({
      severity: "warn",
      message: `Missing ${displayPath(privatePath)}`,
    });
  }

  // Private git config repos
  if (config.canUsePrivate) {
    if (!config.gitConfig.valid) {
      for (const diagnostic of config.gitConfig.diagnostics) {
        results.push({ severity: "error", message: diagnostic });
      }
    } else if (config.gitConfig.repositories.length === 0) {
      results.push({
        severity: "ok",
        message: "No private git repos configured",
      });
    } else {
      for (const repo of managedGitRepos(config.gitConfig)) {
        if (!existsSync(repo.path)) {
          results.push({
            severity: "warn",
            message: `Missing private git repo ${repo.name}: ${displayPath(repo.path)}`,
          });
          continue;
        }

        // Check it's a git repo
        const isGit = yield* gitExitCode(
          ["rev-parse", "--is-inside-work-tree"],
          { cwd: repo.path },
        );
        if (isGit !== 0) {
          results.push({
            severity: "warn",
            message: `Private git repo ${repo.name} is not a git repo: ${displayPath(repo.path)}`,
          });
          continue;
        }

        results.push({
          severity: "ok",
          message: `Found private git repo ${repo.name}: ${displayPath(repo.path)}`,
        });

        // Check on a named branch
        const branch = yield* readGitBranch(repo.path);

        if (!branch || branch === "HEAD") {
          results.push({
            severity: "warn",
            message: `Private git repo ${repo.name} is not on a named branch`,
          });
          continue;
        }

        // Check upstream
        const upstream = yield* readGitUpstream(
          repo.path,
          `${branch}@{upstream}`,
        );

        if (!upstream) {
          results.push({
            severity: "warn",
            message: `Private git repo ${repo.name} branch '${branch}' has no upstream`,
          });
        } else {
          results.push({
            severity: "ok",
            message: `Private git repo ${repo.name} branch OK ('${branch}' -> '${upstream}')`,
          });
        }
      }
    }
  } else {
    results.push({
      severity: "warn",
      message: `Skipping private git repo checks (${config.privateReason})`,
    });
  }

  return results;
});

/** Check private access status (standalone section matching legacy) */
export const checkPrivateAccess = Effect.gen(function* () {
  const config = yield* Config;
  const results: CheckResult[] = [];

  if (config.canUsePrivate) {
    results.push({
      severity: "ok",
      message: `Private repo enabled (${config.privateReason})`,
    });
  } else {
    results.push({
      severity: "warn",
      message: `Private repo disabled (${config.privateReason})`,
    });
  }

  return results;
});
