import { Effect } from "effect";
import { existsSync } from "fs";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;

/** Display path with ~ for HOME */
function displayPath(p: string): string {
  return p.replace(HOME, "~");
}

/** Check public/private dotfiles repos and extra private repos */
export const checkRepos = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
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

  // Extra private repos
  if (config.canUsePrivate) {
    if (config.extraRepos.length === 0) {
      results.push({
        severity: "ok",
        message: "No additional private repos configured",
      });
    } else {
      for (const repo of config.extraRepos) {
        if (!existsSync(repo.path)) {
          results.push({
            severity: "warn",
            message: `Missing extra repo ${repo.name}: ${displayPath(repo.path)}`,
          });
          continue;
        }

        // Check it's a git repo
        const isGit = yield* executor.exitCode("git", [
          "-C",
          repo.path,
          "rev-parse",
          "--is-inside-work-tree",
        ]);
        if (isGit !== 0) {
          results.push({
            severity: "warn",
            message: `Extra repo ${repo.name} is not a git repo: ${displayPath(repo.path)}`,
          });
          continue;
        }

        results.push({
          severity: "ok",
          message: `Found extra repo ${repo.name}: ${displayPath(repo.path)}`,
        });

        // Check on a named branch
        const branchResult = yield* executor
          .run("git", ["-C", repo.path, "rev-parse", "--abbrev-ref", "HEAD"])
          .pipe(Effect.catch(() => Effect.succeed("")));
        const branch = branchResult.trim();

        if (!branch || branch === "HEAD") {
          results.push({
            severity: "warn",
            message: `Extra repo ${repo.name} is not on a named branch`,
          });
          continue;
        }

        // Check upstream
        const upstreamResult = yield* executor
          .run("git", [
            "-C",
            repo.path,
            "rev-parse",
            "--abbrev-ref",
            `${branch}@{upstream}`,
          ])
          .pipe(Effect.catch(() => Effect.succeed("")));
        const upstream = upstreamResult.trim();

        if (!upstream) {
          results.push({
            severity: "warn",
            message: `Extra repo ${repo.name} branch '${branch}' has no upstream`,
          });
        } else {
          results.push({
            severity: "ok",
            message: `Extra repo ${repo.name} branch OK ('${branch}' -> '${upstream}')`,
          });
        }
      }
    }
  } else {
    results.push({
      severity: "warn",
      message: `Skipping additional private repo checks (${config.privateReason})`,
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
