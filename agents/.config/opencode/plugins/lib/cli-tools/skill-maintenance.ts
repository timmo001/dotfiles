import { Duration, Effect, Layer, Schema } from "effect";
import { type ClientNamespace, clientTools, commandExists, runCli, runCliOutput } from "./tool";

const tool = clientTools(Layer.empty);

const COMMAND = "skill-maintenance";

const directory = Schema.optionalKey(
  Schema.String.check(Schema.isStartingWith("/")).annotate({
    description: "The skills repository checkout, when the session isn't in it",
  }),
);

const skill = Schema.String.annotate({ description: "A skill name" });

const cwd = (input: { readonly directory?: string }, context: { readonly directory: string }) =>
  input.directory ?? context.directory;

/** Run a check that reports through its exit code, returning the code with the output instead of failing. */
const report = (args: readonly string[], dir: string, timeout: Duration.Input = "5 minutes") =>
  Effect.map(runCli(COMMAND, args, { cwd: dir, timeout }), (run) => ({
    ok: run.exitCode === 0,
    exitCode: run.exitCode,
    output: [run.stdout.trim(), run.stderr.trim()].filter((text) => text !== "").join("\n"),
  }));

const run = (args: readonly string[], dir: string, options: { json?: boolean; timeout?: Duration.Input } = {}) =>
  runCliOutput(COMMAND, args, { cwd: dir, json: options.json, timeout: options.timeout ?? "5 minutes" });

/** The Agent Skills repository through skill-maintenance. */
export const skillMaintenanceNamespace: ClientNamespace = {
  kind: "client",
  command: "skill-maintenance",
  description:
    "The Agent Skills repository through skill-maintenance, run in the skills checkout: validate skills, check the catalogue, review imports and upstream updates, tool release reviews, and apply imports, updates and consumer syncs.",
  available: commandExists(COMMAND),
  tools: [
    tool({
      name: "validate",
      description: "Validate every skill's frontmatter and the repository metadata.",
      access: "read",
      input: Schema.Struct({ directory }),
      run: (input, context) => report(["validate"], cwd(input, context)),
    }),
    tool({
      name: "catalogue_check",
      description: "Check SKILLS.md matches the catalogue generated from skill frontmatter.",
      access: "read",
      input: Schema.Struct({ directory }),
      run: (input, context) => report(["catalogue", "--check"], cwd(input, context)),
    }),
    tool({
      name: "catalogue",
      description: "Regenerate SKILLS.md from skill frontmatter.",
      access: "write",
      input: Schema.Struct({ directory }),
      run: (input, context) => run(["catalogue"], cwd(input, context)),
    }),
    tool({
      name: "check",
      description: "Review adapted imports against their origins, for every skill or one.",
      access: "read",
      input: Schema.Struct({
        directory,
        skill: Schema.optionalKey(skill),
        diffOrigin: Schema.optionalKey(Schema.Boolean).annotate({ description: "Include complete upstream diffs" }),
      }),
      run: (input, context) =>
        report(
          [
            "check",
            ...(input.skill === undefined ? [] : ["--skill", input.skill]),
            ...(input.diffOrigin ? ["--diff-origin"] : []),
          ],
          cwd(input, context),
        ),
    }),
    tool({
      name: "updates",
      description: "Report tracked upstream skills with updates, as the versioned machine report.",
      access: "read",
      input: Schema.Struct({ directory, skill: Schema.optionalKey(skill) }),
      run: (input, context) =>
        run(["updates", "--json", ...(input.skill === undefined ? [] : ["--skill", input.skill])], cwd(input, context), {
          json: true,
        }),
    }),
    tool({
      name: "updates_apply",
      description: "Apply clean upstream updates and SHA-only refreshes, optionally committing them.",
      access: "write",
      input: Schema.Struct({
        directory,
        skill: Schema.optionalKey(skill),
        commit: Schema.optionalKey(Schema.Boolean),
      }),
      run: (input, context) =>
        run(
          [
            "updates",
            "--update",
            "--skip-review",
            ...(input.skill === undefined ? [] : ["--skill", input.skill]),
            ...(input.commit ? ["--commit"] : []),
          ],
          cwd(input, context),
        ),
    }),
    tool({
      name: "skill_reviews",
      description: "Report skills whose tools have a release newer than the one they were reviewed against.",
      access: "read",
      input: Schema.Struct({ directory }),
      run: (input, context) => run(["skill-reviews", "--json"], cwd(input, context), { json: true }),
    }),
    tool({
      name: "skill_reviews_mark",
      description: "Mark a skill reviewed at its tools' latest releases in skills.yml.",
      access: "write",
      input: Schema.Struct({ directory, skill }),
      resource: (input) => input.skill,
      run: (input, context) => run(["skill-reviews", "--reviewed", input.skill], cwd(input, context)),
    }),
    tool({
      name: "import",
      description: "Fetch an imported skill's upstream and compare it with the local copy, without changing anything.",
      access: "read",
      input: Schema.Struct({ directory, name: skill }),
      run: (input, context) => report(["import", input.name], cwd(input, context)),
    }),
    tool({
      name: "import_apply",
      description: "Apply a clean upstream snapshot of an imported skill, optionally setting the reviewed upstream SHA.",
      access: "write",
      input: Schema.Struct({
        directory,
        name: skill,
        reviewedSha: Schema.optionalKey(Schema.String),
      }),
      resource: (input) => input.name,
      run: (input, context) =>
        run(
          [
            "import",
            input.name,
            "--apply",
            ...(input.reviewedSha === undefined ? [] : ["--reviewed-sha", input.reviewedSha]),
          ],
          cwd(input, context),
        ),
    }),
    tool({
      name: "consumers_sync",
      description:
        "Sync project skill copies into the repositories listed in consumers.yml, committing and pushing, or only report changes with dryRun.",
      access: "write",
      timeout: "15 minutes",
      input: Schema.Struct({
        directory,
        repository: Schema.optionalKey(Schema.String).annotate({ description: "Only this owner/name repository" }),
        dryRun: Schema.optionalKey(Schema.Boolean),
      }),
      run: (input, context) =>
        run(
          [
            "consumers",
            ...(input.repository === undefined ? [] : ["--repository", input.repository]),
            ...(input.dryRun ? ["--dry-run"] : []),
          ],
          cwd(input, context),
          { timeout: "15 minutes" },
        ),
    }),
  ],
};
