import { Duration, Effect, FileSystem, Schema } from "effect";
import { basename, join } from "node:path";
import { pathExists } from "../lib/fsProbe.js";
import { CONFIG_DIR } from "../lib/paths.js";

/** Failure to read, decode or validate a report file. */
export class ReportConfigError extends Schema.TaggedError<ReportConfigError>()(
  "ReportConfigError",
  { message: Schema.String },
) {}

/** Folder of report files, stowed from the private overlay. */
export const REPORTS_DIR = join(CONFIG_DIR, "dot", "reports");

const Id = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/));

const Repository = Schema.String.check(Schema.isPattern(/^[\w.-]+\/[\w.-]+$/));

/** How a bucket's count reads: `good` grows as work gets done, `bad` shrinks. */
const Tone = Schema.Literals(["good", "warn", "bad", "neutral"]);

/** Files are put in the first bucket whose `has` patterns all match and `lacks` patterns all miss. */
const Bucket = Schema.Struct({
  id: Id,
  label: Schema.NonEmptyString,
  tone: Schema.optionalKey(Tone),
  has: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  lacks: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
});

/** Decoded {@link Bucket}. */
export type Bucket = typeof Bucket.Type;

/** A file belongs to the first group whose prefix it starts with. */
const Group = Schema.Struct({
  prefix: Schema.String,
  label: Schema.NonEmptyString,
});

/** A list of files from one bucket, narrowed by path prefix and metric limits. */
const CodeList = Schema.Struct({
  title: Schema.NonEmptyString,
  bucket: Id,
  prefix: Schema.optionalKey(Schema.String),
  /** Highest value of each named metric a file may have, such as `{ reads: 5 }`. */
  max: Schema.optionalKey(Schema.Record(Schema.String, Schema.Finite)),
  /** Lowest value of each named metric a file must have. */
  min: Schema.optionalKey(Schema.Record(Schema.String, Schema.Finite)),
});

/** Regex scan of a repository's files, counted into buckets. */
const CodeSection = Schema.Struct({
  id: Id,
  type: Schema.Literal("code"),
  title: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.String),
  repository: Repository,
  branch: Schema.NonEmptyString,
  include: Schema.NonEmptyArray(Schema.NonEmptyString),
  exclude: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  /** Named regexes tested against each whole file. */
  patterns: Schema.Record(Schema.String, Schema.NonEmptyString),
  buckets: Schema.NonEmptyArray(Bucket),
  groups: Schema.optionalKey(Schema.Array(Group)),
  /** Files tagged as allowed to stay as they are; they still count. */
  allowed: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  /** Named regexes counted per file. */
  metrics: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.NonEmptyString),
  ),
  lists: Schema.optionalKey(Schema.Array(CodeList)),
});

/** Decoded {@link CodeSection}. */
export type CodeSection = typeof CodeSection.Type;

/** GitHub issue or pull request search. */
const GithubSection = Schema.Struct({
  id: Id,
  type: Schema.Literal("github"),
  title: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.String),
  /** GitHub search query; `{since}` becomes the last run's date. */
  query: Schema.NonEmptyString,
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
  ),
  /**
   * Keep only results the decision model in `models.decision` puts under
   * `about` rather than `other`, with at least `min` probability.
   */
  decide: Schema.optionalKey(
    Schema.Struct({
      about: Schema.NonEmptyString,
      other: Schema.optionalKey(Schema.NonEmptyString),
      min: Schema.optionalKey(
        Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
      ),
    }),
  ),
  /** Code section whose files these pull requests change get tagged. */
  files_for: Schema.optionalKey(Id),
});

/** Decoded {@link GithubSection}. */
export type GithubSection = typeof GithubSection.Type;

/** A pattern that should or shouldn't match a file, with a finding shown while it holds. */
const Check = Schema.Struct({
  title: Schema.NonEmptyString,
  file: Schema.NonEmptyString,
  pattern: Schema.NonEmptyString,
  expect: Schema.Literals(["match", "no-match"]),
  finding: Schema.NonEmptyString,
});

/** Decoded {@link Check}. */
export type Check = typeof Check.Type;

/** File checks in a repository. */
const ChecksSection = Schema.Struct({
  id: Id,
  type: Schema.Literal("checks"),
  title: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.String),
  repository: Repository,
  branch: Schema.NonEmptyString,
  checks: Schema.NonEmptyArray(Check),
});

/** Decoded {@link ChecksSection}. */
export type ChecksSection = typeof ChecksSection.Type;

const Section = Schema.Union([CodeSection, GithubSection, ChecksSection]);

/** Decoded report section. */
export type Section = typeof Section.Type;

const ReportFile = Schema.Struct({
  title: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.String),
  inbox: Schema.Struct({
    project: Schema.NonEmptyString,
    thread: Schema.NonEmptyString,
  }),
  /** Skip posting outside work time: days off, out of hours and calendar leave. */
  work_time_only: Schema.optionalKey(Schema.Boolean),
  models: Schema.optionalKey(
    Schema.Struct({
      /** OpenCode models tried in order for a "what changed" paragraph. */
      summary: Schema.optionalKey(
        Schema.Struct({
          models: Schema.NonEmptyArray(Schema.NonEmptyString),
          timeout: Schema.optionalKey(Schema.DurationFromString),
        }),
      ),
      /** Decision model for sections with `decide`: Ollaya, or Workers AI for `@cf/` models. */
      decision: Schema.optionalKey(Schema.NonEmptyString),
    }),
  ),
  sections: Schema.NonEmptyArray(Section),
});

/** A decoded and validated report file. */
export interface ReportConfig {
  /** File name without `.yml`. */
  readonly name: string;
  readonly title: string;
  readonly description: string | undefined;
  readonly inbox: { readonly project: string; readonly thread: string };
  /** Whether a run outside work time is skipped. */
  readonly workTimeOnly: boolean;
  readonly summary:
    | {
        readonly models: readonly string[];
        readonly timeout: Duration.Duration;
      }
    | undefined;
  readonly decisionModel: string | undefined;
  readonly sections: readonly Section[];
}

const compiles = (source: string) => {
  try {
    new RegExp(source, "m");

    return true;
  } catch {
    return false;
  }
};

/** Problems in references between sections and regexes that don't compile. */
function problems(file: typeof ReportFile.Type): string[] {
  const codeIds = new Set(
    file.sections.flatMap((section) =>
      section.type === "code" ? [section.id] : [],
    ),
  );

  const found: string[] = [];
  const ids = new Set<string>();

  for (const section of file.sections) {
    if (ids.has(section.id)) found.push(`section id ${section.id} is repeated`);

    ids.add(section.id);

    if (section.type === "code") {
      const names = new Set(Object.keys(section.patterns));
      const buckets = new Set(section.buckets.map((bucket) => bucket.id));

      for (const [name, source] of [
        ...Object.entries(section.patterns),
        ...Object.entries(section.metrics ?? {}),
      ])
        if (!compiles(source))
          found.push(`${section.id}: ${name} is not a valid regex`);

      for (const bucket of section.buckets)
        for (const name of [...(bucket.has ?? []), ...(bucket.lacks ?? [])])
          if (!names.has(name))
            found.push(
              `${section.id}: bucket ${bucket.id} uses unknown pattern ${name}`,
            );

      for (const list of section.lists ?? []) {
        if (!buckets.has(list.bucket))
          found.push(`${section.id}: list "${list.title}" uses unknown bucket`);

        for (const metric of [
          ...Object.keys(list.max ?? {}),
          ...Object.keys(list.min ?? {}),
        ])
          if (!(metric in (section.metrics ?? {})))
            found.push(
              `${section.id}: list "${list.title}" uses unknown metric ${metric}`,
            );
      }
    }

    if (section.type === "github") {
      if (section.decide && !file.models?.decision)
        found.push(`${section.id}: decide needs models.decision`);

      if (section.files_for && !codeIds.has(section.files_for))
        found.push(
          `${section.id}: files_for names no code section ${section.files_for}`,
        );
    }

    if (section.type === "checks")
      for (const check of section.checks)
        if (!compiles(check.pattern))
          found.push(`${section.id}: "${check.title}" is not a valid regex`);
  }

  return found;
}

/** Path of a named report file. */
export const reportPath = (name: string) => join(REPORTS_DIR, `${name}.yml`);

/** Read and validate the report named `name`. */
export const readReportConfig = Effect.fn("report.readConfig")(function* (
  name: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = reportPath(name);

  if (!(yield* pathExists(path)))
    return yield* new ReportConfigError({
      message: `No report named ${name}: ${path} does not exist`,
    });

  const file = yield* fs.readFileString(path).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap((parsed) =>
      Schema.decodeUnknownEffect(ReportFile)(parsed, {
        onExcessProperty: "error",
      }),
    ),
    Effect.mapError(
      (error) =>
        new ReportConfigError({ message: `${path}: ${error.message}` }),
    ),
  );

  const found = problems(file);

  if (found.length > 0)
    return yield* new ReportConfigError({
      message: `${path}:\n${found.map((line) => `  ${line}`).join("\n")}`,
    });

  return {
    name,
    title: file.title,
    description: file.description,
    inbox: file.inbox,
    workTimeOnly: file.work_time_only ?? false,
    summary: file.models?.summary
      ? {
          models: file.models.summary.models,
          timeout: file.models.summary.timeout ?? Duration.minutes(2),
        }
      : undefined,
    decisionModel: file.models?.decision,
    sections: file.sections,
  } satisfies ReportConfig;
});

/** Names and titles of every report file. */
export const listReports = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* pathExists(REPORTS_DIR))) return [];

  const names = (yield* fs.readDirectory(REPORTS_DIR))
    .filter((entry) => entry.endsWith(".yml"))
    .map((entry) => basename(entry, ".yml"))
    .sort();

  return yield* Effect.forEach(names, (name) =>
    readReportConfig(name).pipe(
      Effect.map((config) => ({ name, title: config.title, error: undefined })),
      Effect.catch((error) =>
        Effect.succeed({ name, title: undefined, error: error.message }),
      ),
    ),
  );
}).pipe(Effect.withSpan("report.list"));
