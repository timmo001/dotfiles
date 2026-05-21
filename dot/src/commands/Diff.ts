import { Effect } from "effect";
import { Config } from "../services/Config.js";
import { DotDiff, DotDiffError } from "../services/DotDiff.js";
import { OutputLog } from "../services/OutputLog.js";

/** Handle DotDiffError by printing to stderr and exiting */
const handleDiffError = Effect.catch((e: DotDiffError) =>
  Effect.sync(() => {
    console.error(`[dot diff] ${e.message}`);
    process.exit(1);
  }),
);

/** Machine output: --waybar JSON */
export const diffWaybar = Effect.gen(function* () {
  const dotDiff = yield* DotDiff;
  const repos = yield* dotDiff.getAll();
  const changed = repos.filter((r) => r.isDirty || r.ahead > 0 || r.behind > 0);

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
    process.stdout.write(JSON.stringify({ text, tooltip, class: cls }) + "\n"),
  );
}).pipe(Effect.withSpan("diff.waybar"), handleDiffError);

/** Machine output: --list-changed */
export const diffListChanged = Effect.gen(function* () {
  const dotDiff = yield* DotDiff;
  const repos = yield* dotDiff.getAll();
  const changed = repos.filter((r) => r.isDirty || r.ahead > 0 || r.behind > 0);
  yield* Effect.sync(() => {
    for (const r of changed) process.stdout.write(`${r.name}|${r.path}\n`);
  });
}).pipe(Effect.withSpan("diff.listChanged"), handleDiffError);

/** Machine output: --list-all */
export const diffListAll = Effect.gen(function* () {
  const dotDiff = yield* DotDiff;
  const repos = yield* dotDiff.getAll();
  yield* Effect.sync(() => {
    for (const r of repos) process.stdout.write(`${r.name}|${r.path}\n`);
  });
}).pipe(Effect.withSpan("diff.listAll"), handleDiffError);

/** CLI text output: --raw */
export const diffRaw = Effect.gen(function* () {
  const config = yield* Config;
  const dotDiff = yield* DotDiff;
  const log = yield* OutputLog;
  const repos = yield* dotDiff.getAll();
  const changed = repos.filter((r) => r.isDirty || r.ahead > 0 || r.behind > 0);

  yield* log.section("Diff Workflow");

  if (changed.length === 0) {
    yield* log.info("All repositories clean");
    return;
  }

  for (const repo of changed) {
    const displayPath = repo.path.replace(process.env.HOME ?? "", "~");
    yield* log.section(`${repo.name} repo: ${displayPath}`);
    if (repo.ahead > 0) yield* log.info(`${repo.ahead} commit(s) ahead`);
    if (repo.behind > 0) yield* log.warn(`${repo.behind} commit(s) behind`);
    if (repo.modified > 0) yield* log.info(`${repo.modified} modified file(s)`);
  }

  if (!config.canUsePrivate) {
    yield* log.warn(
      `Skipping private and notes diff (${config.privateReason})`,
    );
  }
}).pipe(Effect.withSpan("diff.raw"), handleDiffError);
