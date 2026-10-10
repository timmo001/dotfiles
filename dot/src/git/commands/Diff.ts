import { Effect, FileSystem } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import { DotDiff, type DiffScanOptions } from "../services/DotDiff.js";
import { OutputLog } from "../../services/OutputLog.js";
import { managedGitRepoForPath } from "../../services/GitConfig.js";
import { displayPath } from "../../lib/paths.js";
import { cliStyler, colorEnabled } from "../../lib/ansi.js";
import type { DiffRepo } from "../../types.js";
import { textLooksLikeBotActivity } from "../services/botActivity.js";
import { handleCommandError, writeJsonLine, writeText } from "./rows.js";
import { join } from "node:path";

/** Handle DotDiffError by printing to stderr and exiting */
const handleDiffError = handleCommandError("dot git diff");

/** Machine output: status bar JSON. */
export const diffBarJson = (opts?: DiffScanOptions) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const dotDiff = yield* DotDiff;
    const executor = yield* CommandExecutor;
    const repos = yield* dotDiff.getAll({ ...opts, scheduledOnly: true });

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
        .pipe(Effect.orElseSucceed(() => null));

      if (output === null) return repo;

      const authors = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (authors.length === 0) return repo;

      return authors.every(textLooksLikeBotActivity) ? null : repo;
    });

    const changed = (yield* Effect.forEach(
      changedRepos(repos),
      includeBarRepo,
      {
        concurrency: 4,
      },
    )).filter((repo) => repo !== null);

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
      changed.every((repo) => repo.category === "private") &&
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
    repos: changed.map(({ name, path, category, modified, ahead, behind }) => ({
      name,
      path,
      category,
      modified,
      ahead,
      behind,
    })),
  };
}

/** Machine output: full repository state for the native shell panel. */
export const diffPanelJson = (opts?: DiffScanOptions) =>
  Effect.gen(function* () {
    const dotDiff = yield* DotDiff;
    const repos = yield* dotDiff.getAll(opts);
    yield* writeJsonLine(yield* formatDiffPanelJson(repos));
  }).pipe(Effect.withSpan("diff.panelJson"), handleDiffError);

/** Format all repository state for the native shell panel. */
export const formatDiffPanelJson = Effect.fn("diff.formatPanelJson")(function* (
  repos: readonly DiffRepo[],
) {
  const fs = yield* FileSystem.FileSystem;

  const toRow = Effect.fnUntraced(function* (repo: DiffRepo) {
    return {
      name: repo.name,
      path: repo.path,
      category: repo.category,
      modified: repo.modified,
      ahead: repo.ahead,
      behind: repo.behind,
      locked: yield* fs
        .exists(join(repo.path, ".git", "index.lock"))
        .pipe(Effect.orElseSucceed(() => false)),
    };
  });

  return {
    changed: yield* Effect.forEach(changedRepos(repos), toRow),
    other: yield* Effect.forEach(
      repos.filter((repo) => isUnchangedRepo(repo)),
      toRow,
    ),
  };
});

/** Default CLI text output with detailed state for all repositories. */
export const diffRaw = (opts?: DiffScanOptions) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const dotDiff = yield* DotDiff;
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;
    const repos = yield* dotDiff.getAll(opts);
    const style = cliStyler();
    const color = `color.ui=${colorEnabled() ? "always" : "never"}`;

    const git = (path: string, args: readonly string[]) =>
      executor
        .run("git", ["-c", color, ...args], { cwd: path })
        .pipe(Effect.orElseSucceed(() => ""));

    // Print a labelled block of indented git output, or a dimmed empty note.
    const block = (label: string, output: string, empty: string) =>
      Effect.gen(function* () {
        if (!output.trim()) {
          yield* log.info(`${style.label(label)} ${style.dim(empty)}`);

          return;
        }

        yield* log.info(style.label(label));
        yield* writeText(
          output
            .trimEnd()
            .split("\n")
            .map((line) => `    ${line}`)
            .join("\n") + "\n",
        );
      });

    yield* log.section("Diff Workflow");

    for (const repo of repos) {
      yield* log.section(`${repo.name} ${style.dim(displayPath(repo.path))}`);

      yield* block(
        "Git status",
        yield* git(repo.path, ["status", "--short"]),
        "clean",
      );
      yield* block(
        "Unstaged diff",
        yield* git(repo.path, ["diff", "--stat"]),
        "none",
      );
      yield* block(
        "Staged diff",
        yield* git(repo.path, ["diff", "--cached", "--stat"]),
        "none",
      );

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
          yield* block(
            "Unpushed commits",
            yield* git(repo.path, ["log", "@{u}..HEAD", "--oneline", "-20"]),
            "none",
          );
          yield* block(
            "Unpulled commits",
            yield* git(repo.path, ["log", "HEAD..@{u}", "--oneline", "-20"]),
            "none",
          );
        } else {
          yield* log.info(
            `${style.label("Unpushed / unpulled commits")} ${style.dim("no upstream configured")}`,
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

function isUnchangedRepo(repo: DiffRepo): boolean {
  return !repo.isDirty && repo.ahead === 0 && repo.behind === 0;
}
