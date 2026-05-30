import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import {
  DotDiff,
  DotDiffError,
  type DiffScanOptions,
} from "../services/DotDiff.js";
import { OutputLog } from "../../services/OutputLog.js";

/** Handle DotDiffError by printing to stderr and exiting */
const handleDiffError = Effect.catch((e: DotDiffError) =>
  Effect.sync(() => {
    console.error(`[dot git-diff] ${e.message}`);
    process.exit(1);
  }),
);

/** Machine output: --waybar JSON */
export const diffWaybar = (opts?: DiffScanOptions) =>
  Effect.gen(function* () {
    const dotDiff = yield* DotDiff;
    const repos = yield* dotDiff.getAll(opts);
    const changed = repos.filter(
      (r) => r.isDirty || r.ahead > 0 || r.behind > 0,
    );

    const text = changed.length > 0 ? `\uF418 ${changed.length}` : "";
    const tooltip =
      changed.length > 0
        ? `Repositories with changes pending: ${changed.map((r) => r.name).join("; ")}`
        : "All tracked repositories look up to date.";

    // Determine class based on change types (match legacy behaviour)
    let cls: string;
    if (changed.length === 0) {
      cls = "dots-ok";
    } else {
      const hasDirty = changed.some((r) => r.isDirty);
      const hasAhead = changed.some((r) => r.ahead > 0);
      const hasBehind = changed.some((r) => r.behind > 0);
      const onlyPulls = hasBehind && !hasDirty && !hasAhead;
      const onlyExtra =
        changed.every((r) => r.name.startsWith("extra:")) &&
        hasDirty &&
        !hasAhead &&
        !hasBehind;

      if (onlyPulls) {
        cls = "dots-pull-only";
      } else if (onlyExtra) {
        cls = "dots-extra-only";
      } else {
        cls = "dots-attention";
      }
    }

    yield* Effect.sync(() =>
      process.stdout.write(
        JSON.stringify({ text, tooltip, class: cls }) + "\n",
      ),
    );
  }).pipe(Effect.withSpan("diff.waybar"), handleDiffError);

/** Machine output: --list-changed */
export const diffListChanged = (opts?: DiffScanOptions) =>
  Effect.gen(function* () {
    const dotDiff = yield* DotDiff;
    const repos = yield* dotDiff.getAll(opts);
    const changed = repos.filter(
      (r) => r.isDirty || r.ahead > 0 || r.behind > 0,
    );
    yield* Effect.sync(() => {
      for (const r of changed) process.stdout.write(`${r.name}|${r.path}\n`);
    });
  }).pipe(Effect.withSpan("diff.listChanged"), handleDiffError);

/** Machine output: --list-all (lightweight, no git scan) */
export const diffListAll = Effect.gen(function* () {
  const dotDiff = yield* DotDiff;
  const repos = yield* dotDiff.listAll();
  yield* Effect.sync(() => {
    for (const r of repos) process.stdout.write(`${r.name}|${r.path}\n`);
  });
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
      const displayPath = repo.path.replace(process.env.HOME ?? "", "~");
      yield* log.section(`${repo.name} repo: ${displayPath}`);

      // Git status (short)
      const statusOut = yield* executor
        .run("git", ["status", "--short"], { cwd: repo.path })
        .pipe(Effect.catch(() => Effect.succeed("")));
      if (statusOut.trim()) {
        yield* log.info("Git status:");
        yield* Effect.sync(() => process.stdout.write(statusOut));
      } else {
        yield* log.info("Git status: clean");
      }

      // Unstaged diff stat
      const unstagedOut = yield* executor
        .run("git", ["diff", "--stat"], { cwd: repo.path })
        .pipe(Effect.catch(() => Effect.succeed("")));
      if (unstagedOut.trim()) {
        yield* log.info("Unstaged diff:");
        yield* Effect.sync(() => process.stdout.write(unstagedOut));
      } else {
        yield* log.info("Unstaged diff: none");
      }

      // Staged diff stat
      const stagedOut = yield* executor
        .run("git", ["diff", "--cached", "--stat"], { cwd: repo.path })
        .pipe(Effect.catch(() => Effect.succeed("")));
      if (stagedOut.trim()) {
        yield* log.info("Staged diff:");
        yield* Effect.sync(() => process.stdout.write(stagedOut));
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
            yield* Effect.sync(() => process.stdout.write(unpushedOut));
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
            yield* Effect.sync(() => process.stdout.write(unpulledOut));
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
