import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import {
  DotDiff,
  DotDiffError,
  type DiffScanOptions,
} from "../services/DotDiff.js";
import { OutputLog } from "../../services/OutputLog.js";
import { managedGitRepoForPath } from "../../services/GitConfig.js";
import { displayPath } from "../../lib/paths.js";
import type { DiffRepo } from "../../types.js";
import { textLooksLikeBotActivity } from "../services/botActivity.js";
import {
  handleCommandError,
  pipeRow,
  writeJsonLine,
  writeRows,
  writeText,
} from "./rows.js";

/** Handle DotDiffError by printing to stderr and exiting */
const handleDiffError = handleCommandError("dot git-diff");

/** Machine output: status bar JSON. */
export const diffBarJson = (opts?: DiffScanOptions) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const dotDiff = yield* DotDiff;
    const executor = yield* CommandExecutor;
    const repos = yield* dotDiff.getAll(opts);
    const includeBarRepo = Effect.fn("diff.includeBarRepo")(function* (
      repo: DiffRepo,
    ) {
      const managedRepo = managedGitRepoForPath(config.gitConfig, repo.path);
      if (!managedRepo?.notifications.bar.ignoreBotActivity) return repo;
      if (repo.isDirty || repo.ahead > 0 || repo.behind === 0) return repo;

      const output = yield* executor
        .run("git", ["log", "HEAD..@{u}", "--pretty=%an <%ae>"], {
          cwd: repo.path,
        })
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (output === null) return repo;

      const authors = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (authors.length === 0) return repo;

      return authors.every(textLooksLikeBotActivity) ? null : repo;
    });
    const changed = (yield* Effect.all(
      changedRepos(repos).map(includeBarRepo),
      {
        concurrency: 4,
      },
    )).filter((repo): repo is DiffRepo => repo !== null);

    yield* writeJsonLine(formatDiffBarJson(changed));
  }).pipe(Effect.withSpan("diff.barJson"), handleDiffError);

/** Format repository state for status bars and the native shell panel. */
export function formatDiffBarJson(changed: readonly DiffRepo[]) {
  const text = `\uF418 ${changed.length}`;
  const tooltip =
    changed.length > 0
      ? `Repositories with changes pending: ${changed.map((repo) => repo.name).join("; ")}`
      : "All tracked repositories look up to date.";

  let cls: string;
  if (changed.length === 0) {
    cls = "dots-ok";
  } else {
    const hasDirty = changed.some((repo) => repo.isDirty);
    const hasAhead = changed.some((repo) => repo.ahead > 0);
    const hasBehind = changed.some((repo) => repo.behind > 0);
    const onlyPulls = hasBehind && !hasDirty && !hasAhead;
    const onlyExtra =
      changed.every(
        (repo) =>
          repo.name.startsWith("private:") || repo.name.startsWith("extra:"),
      ) &&
      hasDirty &&
      !hasAhead &&
      !hasBehind;

    if (onlyPulls) cls = "dots-pull-only";
    else if (onlyExtra) cls = "dots-extra-only";
    else cls = "dots-attention";
  }

  return {
    text,
    tooltip,
    class: cls,
    repos: changed.map(({ name, category, modified, ahead, behind }) => ({
      name,
      category,
      modified,
      ahead,
      behind,
    })),
  };
}

/** Machine output: --list-changed */
export const diffListChanged = (opts?: DiffScanOptions) =>
  Effect.gen(function* () {
    const dotDiff = yield* DotDiff;
    const repos = yield* dotDiff.getAll(opts);
    const changed = changedRepos(repos);
    yield* writeRows(changed.map((repo) => pipeRow([repo.name, repo.path])));
  }).pipe(Effect.withSpan("diff.listChanged"), handleDiffError);

/** Machine output: --list-all (lightweight, no git scan) */
export const diffListAll = Effect.gen(function* () {
  const dotDiff = yield* DotDiff;
  const repos = yield* dotDiff.listAll();
  yield* writeRows(repos.map((repo) => pipeRow([repo.name, repo.path])));
}).pipe(Effect.withSpan("diff.listAll"), handleDiffError);

/** CLI text output: --raw (detailed, shows all repos like legacy) */
export const diffRaw = (opts?: DiffScanOptions) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const dotDiff = yield* DotDiff;
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;
    const repos = yield* dotDiff.getAll(opts);

    yield* log.section("Diff Workflow");

    for (const repo of repos) {
      yield* log.section(`${repo.name} repo: ${displayPath(repo.path)}`);

      // Git status (short)
      const statusOut = yield* executor
        .run("git", ["status", "--short"], { cwd: repo.path })
        .pipe(Effect.catch(() => Effect.succeed("")));
      if (statusOut.trim()) {
        yield* log.info("Git status:");
        yield* writeText(statusOut);
      } else {
        yield* log.info("Git status: clean");
      }

      // Unstaged diff stat
      const unstagedOut = yield* executor
        .run("git", ["diff", "--stat"], { cwd: repo.path })
        .pipe(Effect.catch(() => Effect.succeed("")));
      if (unstagedOut.trim()) {
        yield* log.info("Unstaged diff:");
        yield* writeText(unstagedOut);
      } else {
        yield* log.info("Unstaged diff: none");
      }

      // Staged diff stat
      const stagedOut = yield* executor
        .run("git", ["diff", "--cached", "--stat"], { cwd: repo.path })
        .pipe(Effect.catch(() => Effect.succeed("")));
      if (stagedOut.trim()) {
        yield* log.info("Staged diff:");
        yield* writeText(stagedOut);
      } else {
        yield* log.info("Staged diff: none");
      }

      // Ahead/behind commits
      if (
        repo.ahead > 0 ||
        repo.behind > 0 ||
        (!repo.isDirty && repo.ahead === 0 && repo.behind === 0)
      ) {
        // Check if upstream is configured
        const hasUpstream = yield* executor.exitCode(
          "git",
          ["rev-parse", "@{u}"],
          { cwd: repo.path },
        );

        if (hasUpstream === 0) {
          // Unpushed commits (up to 20)
          const unpushedOut = yield* executor
            .run("git", ["log", "@{u}..HEAD", "--oneline", "-20"], {
              cwd: repo.path,
            })
            .pipe(Effect.catch(() => Effect.succeed("")));
          if (unpushedOut.trim()) {
            yield* log.info("Unpushed commits:");
            yield* writeText(unpushedOut);
          } else {
            yield* log.info("Unpushed commits: none");
          }

          // Unpulled commits (up to 20)
          const unpulledOut = yield* executor
            .run("git", ["log", "HEAD..@{u}", "--oneline", "-20"], {
              cwd: repo.path,
            })
            .pipe(Effect.catch(() => Effect.succeed("")));
          if (unpulledOut.trim()) {
            yield* log.info("Unpulled commits:");
            yield* writeText(unpulledOut);
          } else {
            yield* log.info("Unpulled commits: none");
          }
        } else {
          yield* log.info(
            "Unpushed / unpulled commits: no upstream configured",
          );
        }
      }
    }

    if (!config.canUsePrivate) {
      yield* log.warn(`Skipping private diff (${config.privateReason})`);
    }
  }).pipe(Effect.withSpan("diff.raw"), handleDiffError);

function changedRepos(repos: readonly DiffRepo[]): DiffRepo[] {
  return repos.filter((r) => r.isDirty || r.ahead > 0 || r.behind > 0);
}
