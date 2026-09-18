import { Effect, Predicate, Record, Schema } from "effect";
import { parseDocument } from "yaml";
import {
  DependencyDiscoveryError,
  type Dependency,
  type Extraction,
} from "../model.js";

const Step = Schema.Struct({ uses: Schema.optionalKey(Schema.String) });

const Job = Schema.Struct({
  uses: Schema.optionalKey(Schema.String),
  steps: Schema.optionalKey(Schema.Array(Step)),
});

const Workflow = Schema.Struct({
  jobs: Schema.optionalKey(Schema.Record(Schema.String, Job)),
  runs: Schema.optionalKey(
    Schema.Struct({ steps: Schema.optionalKey(Schema.Array(Step)) }),
  ),
});

/** Extract action/reusable-workflow references, retaining SHA pins and tag comments. */
export const extractGithubActions = Effect.fn(
  "Dependencies.extractGithubActions",
)(function* (
  file: string,
  text: string,
): Effect.fn.Return<Extraction, DependencyDiscoveryError> {
  const document = parseDocument(text);

  if (document.errors.length)
    return yield* new DependencyDiscoveryError({
      message: `Invalid workflow YAML: ${file}`,
    });
  const dependencies: Dependency[] = [];
  const blockers: string[] = [];

  const value = yield* Effect.try({
    try: () => document.toJS(),
    catch: () =>
      new DependencyDiscoveryError({
        message: `Invalid workflow aliases: ${file}`,
      }),
  });

  const workflow = yield* Schema.decodeUnknownEffect(Workflow)(value).pipe(
    Effect.mapError(
      () =>
        new DependencyDiscoveryError({
          message: `Invalid action references: ${file}`,
        }),
    ),
  );

  const comments = new Map(
    [
      ...text.matchAll(
        /^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)["']?\s*(?:#\s*(\S+))?/gm,
      ),
    ].map((match) => [match[1], match[2]]),
  );

  const references = [
    ...Object.values(workflow.jobs ?? {}).flatMap((job) => [
      job.uses,
      ...(job.steps ?? []).map((step) => step.uses),
    ]),
    ...(workflow.runs?.steps ?? []).map((step) => step.uses),
  ].filter(Predicate.isNotUndefined);

  for (const reference of references) {
    if (reference.startsWith("./")) continue;
    const remote = /^([\w.-]+\/[\w.-]+)(?:\/[^@]+)?@(.+)$/.exec(reference);

    if (!remote) {
      blockers.push(`${file}: unsupported action reference ${reference}`);
      continue;
    }

    const digest = /^[a-f\d]{40}$/i.test(remote[2]) ? remote[2] : undefined;
    const comment = comments.get(reference);

    const version =
      comment && /^v?\d+(?:\.\d+){0,2}(?:-[\w.-]+)?$/.test(comment)
        ? comment
        : undefined;

    dependencies.push({
      manager: "github-actions",
      file,
      name: reference.slice(0, reference.lastIndexOf("@")),
      package: remote[1],
      datasource:
        (digest && !version) || (!digest && !/^v?\d/.test(remote[2]))
          ? "git-refs"
          : "github-tags",
      current: digest ? (version ?? "HEAD") : remote[2],
      ...Record.filter({ digest }, Predicate.isNotUndefined),
      sourceUrl: `https://github.com/${remote[1]}`,
      dependencyType: "action",
    });
  }

  return { dependencies, blockers };
});
