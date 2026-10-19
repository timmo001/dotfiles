import { Effect, FileSystem } from "effect";
import { join } from "node:path";
import type { Checkout } from "./checkout.js";
import type { CodeSection } from "./config.js";
import type { CodeFile, CodeResult } from "./result.js";

const OTHER_GROUP = "Other";

/** Files under `cwd` matching any `include` glob and no `exclude` glob, sorted. */
const globFiles = (
  cwd: string,
  include: readonly string[],
  exclude: readonly string[],
) =>
  Effect.promise(async () => {
    const excluded = exclude.map((pattern) => new Bun.Glob(pattern));
    const found = new Set<string>();

    for (const pattern of include)
      for await (const path of new Bun.Glob(pattern).scan({ cwd }))
        if (!excluded.some((glob) => glob.match(path))) found.add(path);

    return [...found].sort();
  });

/**
 * Scan a checkout: test each file against the section's patterns, put it in
 * the first bucket it fits, count its metrics and name its group. Files that
 * fit no bucket are left out.
 */
export const runCodeSection = Effect.fn("report.code")(function* (
  section: CodeSection,
  checkout: Checkout,
  pullRequestsByPath: ReadonlyMap<string, readonly number[]>,
) {
  const fs = yield* FileSystem.FileSystem;

  const patterns = Object.entries(section.patterns).map(
    ([name, source]) => [name, new RegExp(source, "m")] as const,
  );

  const metrics = Object.entries(section.metrics ?? {}).map(
    ([name, source]) => [name, new RegExp(source, "gm")] as const,
  );

  const allowed = new Set(section.allowed ?? []);

  const paths = yield* globFiles(
    checkout.path,
    section.include,
    section.exclude ?? [],
  );

  const files = yield* Effect.forEach(
    paths,
    (path) =>
      fs.readFileString(join(checkout.path, path)).pipe(
        Effect.map((text): CodeFile | undefined => {
          const matched = new Set(
            patterns.flatMap(([name, regex]) =>
              regex.test(text) ? [name] : [],
            ),
          );

          const bucket = section.buckets.find(
            (candidate) =>
              (candidate.has ?? []).every((name) => matched.has(name)) &&
              (candidate.lacks ?? []).every((name) => !matched.has(name)),
          );

          if (!bucket) return undefined;

          return {
            path,
            bucket: bucket.id,
            group:
              section.groups?.find((group) => path.startsWith(group.prefix))
                ?.label ?? OTHER_GROUP,
            allowed: allowed.has(path),
            metrics: Object.fromEntries(
              metrics.map(([name, regex]) => [
                name,
                text.match(regex)?.length ?? 0,
              ]),
            ),
            pullRequests: pullRequestsByPath.get(path) ?? [],
          };
        }),
      ),
    { concurrency: 32 },
  );

  const kept = files.filter((file) => file !== undefined);

  return {
    type: "code",
    section,
    checkout,
    files: kept,
    counts: Object.fromEntries(
      section.buckets.map((bucket) => [
        bucket.id,
        kept.filter((file) => file.bucket === bucket.id).length,
      ]),
    ),
  } satisfies CodeResult;
});

/** Files of a code section's list, ordered by their first metric then path. */
export const listFiles = (
  result: CodeResult,
  list: NonNullable<CodeSection["lists"]>[number],
) =>
  result.files
    .filter(
      (file) =>
        file.bucket === list.bucket &&
        file.path.startsWith(list.prefix ?? "") &&
        Object.entries(list.max ?? {}).every(
          ([name, max]) => (file.metrics[name] ?? 0) <= max,
        ) &&
        Object.entries(list.min ?? {}).every(
          ([name, min]) => (file.metrics[name] ?? 0) >= min,
        ),
    )
    .sort((a, b) => {
      const [metric] = Object.keys(list.max ?? list.min ?? {});

      return metric
        ? (a.metrics[metric] ?? 0) - (b.metrics[metric] ?? 0) ||
            a.path.localeCompare(b.path)
        : a.path.localeCompare(b.path);
    });
