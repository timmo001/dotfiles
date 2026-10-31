import { Effect, Option, Schema } from "effect";
import { join, resolve } from "path";
import { pathExists, readTextOrNull } from "../../lib/fsProbe.js";
import { gitOutput } from "../../lib/git.js";
import { hasGlobalHkHooks } from "../../lib/gitHooks.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import { managedGitRepos } from "../../services/GitConfig.js";
import type { CheckResult } from "../types.js";

/** The part of `mise tasks info --json` this check reads. */
const MiseTaskInfo = Schema.Struct({ run: Schema.Array(Schema.String) });

/** The git hooks a task's `mise generate git-pre-commit` lines write. */
function generatedHookNames(run: readonly string[]): readonly string[] {
  return run.flatMap((line) =>
    line.includes("git-pre-commit")
      ? [/--hook[ =](\S+)/.exec(line)?.[1] ?? "pre-commit"]
      : [],
  );
}

/** The hooks a repository's `install:hooks` mise task writes, if it has one. */
const installHooksTaskHooks = Effect.fn("doctor.installHooksTaskHooks")(
  function* (repoPath: string) {
    const miseConfig = yield* readTextOrNull(join(repoPath, "mise.toml"));

    if (!miseConfig?.includes("install:hooks")) return [];

    const executor = yield* CommandExecutor;

    const info = yield* executor
      .run("mise", ["tasks", "info", "install:hooks", "--json"], {
        cwd: repoPath,
      })
      .pipe(
        Effect.map(Schema.decodeOption(Schema.fromJsonString(MiseTaskInfo))),
        Effect.orElseSucceed(() => Option.none()),
      );

    return Option.match(info, {
      onNone: () => [],
      onSome: (task) => generatedHookNames(task.run),
    });
  },
);

/**
 * Check that git hooks repositories ask for are installed: hk's global hooks
 * for any repository with an `hk.pkl`, and the hooks an `install:hooks` mise
 * task writes, since `.git/hooks` is never cloned.
 */
export const checkGitHooks = Effect.gen(function* () {
  const config = yield* Config;
  const results: CheckResult[] = [];
  const globalHk = yield* hasGlobalHkHooks;

  results.push({
    severity: "ok",
    message: `Global hk hooks ${globalHk ? "installed" : "not installed"}`,
  });

  if (!config.gitConfig.valid) return results;

  for (const repo of managedGitRepos(config.gitConfig)) {
    if (!(yield* pathExists(join(repo.path, ".git")))) continue;

    const hasHkConfig =
      (yield* pathExists(join(repo.path, "hk.pkl"))) ||
      (yield* pathExists(join(repo.path, ".config", "hk.pkl")));

    if (hasHkConfig && !globalHk) {
      results.push({
        severity: "warn",
        message: `${repo.name} has an hk.pkl, but hk's hooks are not installed`,
        detail: "Run: dot up (or hk install --global --mise)",
      });
    }

    for (const hook of yield* installHooksTaskHooks(repo.path)) {
      const hookPath = yield* gitOutput(
        ["rev-parse", "--git-path", `hooks/${hook}`],
        {
          cwd: repo.path,
        },
      ).pipe(
        Effect.map((output) => output.trim()),
        Effect.orElseSucceed(() => ""),
      );

      if (hookPath && (yield* pathExists(resolve(repo.path, hookPath)))) {
        results.push({
          severity: "ok",
          message: `${repo.name} has its ${hook} hook`,
        });
      } else {
        results.push({
          severity: "warn",
          message: `${repo.name} is missing its ${hook} hook`,
          detail: `Run: mise run install:hooks (in ${repo.path})`,
        });
      }
    }
  }

  return results;
});
