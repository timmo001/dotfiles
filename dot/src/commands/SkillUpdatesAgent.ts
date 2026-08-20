import { Cause, Effect, Schema, Stream } from "effect";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { ENV, envString } from "../lib/env.js";
import { expandHomePath } from "../lib/paths.js";
import { GitHub } from "../git/services/GitHub.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";

const SUCCESS_PREFIX = "STATUS: success";
const FAILURE_PREFIX = "STATUS: failure";

/** One model attempt in the ordered OpenCode fallback chain. */
export const SkillUpdatesAgentModel = Schema.Struct({
  providerID: Schema.String.check(Schema.isNonEmpty()),
  modelID: Schema.String.check(Schema.isNonEmpty()),
  variant: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
});

/** One model attempt in the ordered OpenCode fallback chain. */
export interface SkillUpdatesAgentModel extends Schema.Schema.Type<
  typeof SkillUpdatesAgentModel
> {}

/** Private configuration for scheduled skill update processing. */
export const SkillUpdatesAgentConfig = Schema.Struct({
  workflowApi: Schema.String.check(Schema.isNonEmpty()),
  dashboardIssue: Schema.String.check(Schema.isNonEmpty()),
  repositories: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(10),
  ),
  stateFile: Schema.String.check(Schema.isNonEmpty()),
  opencodeCommand: Schema.String.check(Schema.isNonEmpty()),
  opencodeAgent: Schema.String.check(Schema.isNonEmpty()),
  opencodeModels: Schema.Array(SkillUpdatesAgentModel).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(5),
  ),
  prompt: Schema.String.check(Schema.isNonEmpty()),
});

/** Private configuration for scheduled skill update processing. */
export interface SkillUpdatesAgentConfig extends Schema.Schema.Type<
  typeof SkillUpdatesAgentConfig
> {}

const WorkflowRun = Schema.Struct({
  id: Schema.Int.check(Schema.isGreaterThan(0)),
  conclusion: Schema.NullOr(Schema.String),
  html_url: Schema.String,
});

const WorkflowRuns = Schema.Struct({
  workflow_runs: Schema.Array(WorkflowRun),
});

const PullRequestNumbers = Schema.Array(
  Schema.Struct({ number: Schema.Int.check(Schema.isGreaterThan(0)) }),
);

const PullRequestPolicy = Schema.Struct({
  title: Schema.String,
  state: Schema.String,
  mergedAt: Schema.NullOr(Schema.String),
  assignees: Schema.Array(Schema.Struct({ login: Schema.String })),
  autoMergeRequest: Schema.NullOr(
    Schema.Struct({ mergeMethod: Schema.String }),
  ),
  commits: Schema.Array(Schema.Struct({ messageHeadline: Schema.String })),
});

const GitHubImportStatuses = Schema.Array(
  Schema.Struct({ name: Schema.String, state: Schema.String }),
);

/** Select imports that the GitHub phase can update without manual review. */
export function cleanSkillUpdateNames(
  statuses: Schema.Schema.Type<typeof GitHubImportStatuses>,
): readonly string[] {
  return statuses
    .filter(({ state }) => state === "update-available")
    .map(({ name }) => name);
}

/** A successfully completed workflow run accepted for processing. */
export interface SuccessfulWorkflowRun {
  readonly id: number;
  readonly url: string;
}

interface RepositoryState {
  readonly path: string;
  readonly branch: string;
}

/** Failure raised by scheduled skill update processing. */
export class SkillUpdatesAgentError extends Schema.TaggedErrorClass<SkillUpdatesAgentError>()(
  "SkillUpdatesAgentError",
  { operation: Schema.String, message: Schema.String },
) {}

/** Select the newest successful workflow run from a decoded GitHub response. */
export function latestSuccessfulWorkflowRun(
  runs: Schema.Schema.Type<typeof WorkflowRuns>,
): SuccessfulWorkflowRun | null {
  const run = runs.workflow_runs.find(
    ({ conclusion }) => conclusion === "success",
  );
  return run ? { id: run.id, url: run.html_url } : null;
}

/** Render the configured task with trusted workflow context and result contract. */
export function skillUpdatesAgentPrompt(
  config: SkillUpdatesAgentConfig,
  run: SuccessfulWorkflowRun,
): string {
  return [
    config.prompt.trim(),
    "",
    "Trusted automation context:",
    `- Dashboard issue: ${config.dashboardIssue}`,
    `- Completed workflow run: ${run.url}`,
    "",
    "Return exactly one status line followed by a concise summary. Use `STATUS: success` only after all requested work and cleanup completed. Use `STATUS: failure` followed by the blocker otherwise.",
  ].join("\n");
}

/** Format one configured OpenCode model for the CLI. */
export function skillUpdatesAgentModelArgument(
  model: SkillUpdatesAgentModel,
): string {
  return `${model.providerID}/${model.modelID}${model.variant ? `#${model.variant}` : ""}`;
}

/** Convert an api.github.com workflow URL to the endpoint accepted by `gh api`. */
export function skillUpdatesWorkflowEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "api.github.com") {
      return null;
    }
    return `${url.pathname.replace(/^\//, "")}${url.search}`;
  } catch {
    return null;
  }
}

function loadConfig(filePath: string) {
  return Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => Bun.YAML.parse(readFileSync(filePath, "utf8")),
      catch: (error) =>
        new SkillUpdatesAgentError({
          operation: "config.read",
          message: String(error),
        }),
    });
    const config = yield* Schema.decodeUnknownEffect(SkillUpdatesAgentConfig)(
      parsed,
    ).pipe(
      Effect.mapError(
        (error) =>
          new SkillUpdatesAgentError({
            operation: "config.decode",
            message: String(error),
          }),
      ),
    );
    return {
      ...config,
      repositories: config.repositories.map(expandHomePath),
      stateFile: expandHomePath(config.stateFile),
      opencodeCommand: expandHomePath(config.opencodeCommand),
    } satisfies SkillUpdatesAgentConfig;
  });
}

const fetchLatestRun = Effect.fn("SkillUpdatesAgent.fetchLatestRun")(function* (
  workflowApi: string,
) {
  const github = yield* GitHub;
  const endpoint = skillUpdatesWorkflowEndpoint(workflowApi);
  if (!endpoint) {
    return yield* new SkillUpdatesAgentError({
      operation: "workflow.url",
      message: "workflowApi must be an https://api.github.com URL",
    });
  }
  const raw = yield* github.api(endpoint).pipe(
    Effect.mapError(
      (error) =>
        new SkillUpdatesAgentError({
          operation: "workflow.fetch",
          message: error.stderr,
        }),
    ),
  );
  const value = yield* Effect.try({
    try: () => JSON.parse(raw),
    catch: (error) =>
      new SkillUpdatesAgentError({
        operation: "workflow.json",
        message: String(error),
      }),
  });
  const runs = yield* Schema.decodeUnknownEffect(WorkflowRuns)(value).pipe(
    Effect.mapError(
      (error) =>
        new SkillUpdatesAgentError({
          operation: "workflow.decode",
          message: String(error),
        }),
    ),
  );
  const run = latestSuccessfulWorkflowRun(runs);
  if (run) return run;
  return yield* new SkillUpdatesAgentError({
    operation: "workflow.select",
    message: "No successful workflow run was found",
  });
});

const fetchRunById = Effect.fn("SkillUpdatesAgent.fetchRunById")(function* (
  runId: string,
) {
  if (!/^\d+$/.test(runId)) {
    return yield* new SkillUpdatesAgentError({
      operation: "workflow.run-id",
      message: `Invalid workflow run id: ${runId}`,
    });
  }
  const github = yield* GitHub;
  const raw = yield* github
    .api(`repos/timmo001/skills/actions/runs/${runId}`)
    .pipe(
      Effect.mapError(
        (error) =>
          new SkillUpdatesAgentError({
            operation: "workflow.fetch",
            message: error.stderr,
          }),
      ),
    );
  const value = yield* Effect.try({
    try: () => JSON.parse(raw),
    catch: (error) =>
      new SkillUpdatesAgentError({
        operation: "workflow.json",
        message: String(error),
      }),
  });
  const run = yield* Schema.decodeUnknownEffect(WorkflowRun)(value).pipe(
    Effect.mapError(
      (error) =>
        new SkillUpdatesAgentError({
          operation: "workflow.decode",
          message: String(error),
        }),
    ),
  );
  if (run.conclusion !== "success") {
    return yield* new SkillUpdatesAgentError({
      operation: "workflow.select",
      message: `Workflow run ${run.id} concluded ${run.conclusion ?? "without a result"}`,
    });
  }
  return { id: run.id, url: run.html_url } satisfies SuccessfulWorkflowRun;
});

function completedRun(stateFile: string): string | null {
  return existsSync(stateFile) ? readFileSync(stateFile, "utf8").trim() : null;
}

function recordCompletedRun(stateFile: string, runId: number): void {
  mkdirSync(dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.${process.pid}`;
  writeFileSync(temporary, `${runId}\n`, { mode: 0o600 });
  renameSync(temporary, stateFile);
}

function migrateLegacyLock(lockFile: string): void {
  if (existsSync(lockFile) && statSync(lockFile).isDirectory()) {
    rmSync(lockFile, { recursive: true, force: true });
  }
}

const runWithProcessLock = Effect.fn("SkillUpdatesAgent.runWithProcessLock")(
  function* (configPath: string, stateFile: string, runId?: string) {
    const executor = yield* CommandExecutor;
    const lockFile = `${stateFile}.lock`;
    yield* Effect.sync(() => {
      mkdirSync(dirname(stateFile), { recursive: true });
      migrateLegacyLock(lockFile);
    });
    const exitCode = yield* executor.inherit("flock", [
      "--nonblock",
      "--conflict-exit-code",
      "75",
      lockFile,
      "env",
      `${ENV.DOT_SKILL_UPDATES_AGENT_LOCKED}=1`,
      process.execPath,
      "skill-updates-agent",
      "device",
      "--config",
      configPath,
      ...(runId ? ["--run-id", runId] : []),
    ]);
    if (exitCode === 0) return;
    return yield* new SkillUpdatesAgentError({
      operation: exitCode === 75 ? "run.lock" : "run.child",
      message:
        exitCode === 75
          ? "Another skill updates agent run is active"
          : `Locked skill updates agent exited with code ${exitCode}`,
    });
  },
);

/** Read the final explicit agent status from OpenCode's streamed text output. */
export function skillUpdatesAgentResultStatus(
  output: string,
): "success" | "failure" | null {
  const statuses = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line === SUCCESS_PREFIX || line === FAILURE_PREFIX);
  if (statuses.length !== 1) return null;
  if (statuses[0] === SUCCESS_PREFIX) return "success";
  if (statuses[0] === FAILURE_PREFIX) return "failure";
  return null;
}

/** Return whether a pull request patch changes only one skill's SHA metadata. */
export function isShaOnlySkillPatch(patch: string, skill: string): boolean {
  const changes = new Map<string, { removed: string[]; added: string[] }>();
  let currentFile: string | null = null;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const file = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (file) {
      if (file[1] !== file[2] || changes.has(file[1])) return false;
      currentFile = file[1];
      changes.set(currentFile, { removed: [], added: [] });
      inHunk = false;
      continue;
    }
    if (!currentFile) {
      if (line) return false;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      if (
        line.startsWith("index ") ||
        line === `--- a/${currentFile}` ||
        line === `+++ b/${currentFile}` ||
        !line
      )
        continue;
      return false;
    }
    const change = changes.get(currentFile);
    if (!change) return false;
    if (line.startsWith("-")) change.removed.push(line.slice(1));
    else if (line.startsWith("+")) change.added.push(line.slice(1));
  }

  const metadata = changes.get("imports.json");
  const frontmatter = changes.get(`${skill}/SKILL.md`);
  if (changes.size !== 2 || !metadata || !frontmatter) return false;
  if (
    metadata.removed.length !== 1 ||
    metadata.added.length !== 1 ||
    frontmatter.removed.length !== 1 ||
    frontmatter.added.length !== 1
  )
    return false;

  const shaPattern = /"upstreamSha": "([0-9a-f]{40})"/;
  const oldMetadata = metadata.removed[0];
  const newMetadata = metadata.added[0];
  const oldSha = oldMetadata?.match(shaPattern)?.[1];
  const newSha = newMetadata?.match(shaPattern)?.[1];
  const oldFrontmatter = frontmatter.removed[0]?.match(
    /^# upstream-sha: ([0-9a-f]{40})$/,
  )?.[1];
  const newFrontmatter = frontmatter.added[0]?.match(
    /^# upstream-sha: ([0-9a-f]{40})$/,
  )?.[1];
  return (
    oldMetadata?.includes(`"${skill}":`) === true &&
    newMetadata?.includes(`"${skill}":`) === true &&
    oldSha !== undefined &&
    newSha !== undefined &&
    oldSha !== newSha &&
    oldMetadata.replace(shaPattern, '"upstreamSha": "<sha>"') ===
      newMetadata.replace(shaPattern, '"upstreamSha": "<sha>"') &&
    oldFrontmatter === oldSha &&
    newFrontmatter === newSha
  );
}

const requireCleanRepositories = Effect.fn(
  "SkillUpdatesAgent.requireCleanRepositories",
)(function* (repositories: readonly string[]) {
  const executor = yield* CommandExecutor;
  const states: RepositoryState[] = [];
  for (const repository of repositories) {
    if (!existsSync(join(repository, ".git"))) {
      return yield* new SkillUpdatesAgentError({
        operation: "repository.check",
        message: `Required repository is unavailable: ${repository}`,
      });
    }
    const status = yield* executor.run(
      "git",
      ["-C", repository, "status", "--porcelain"],
      { cwd: repository },
    );
    if (status.trim()) {
      return yield* new SkillUpdatesAgentError({
        operation: "repository.check",
        message: `Refusing to run with uncommitted changes in ${repository}`,
      });
    }
    const branch = (yield* executor.run(
      "git",
      ["-C", repository, "branch", "--show-current"],
      { cwd: repository },
    )).trim();
    if (!branch) {
      return yield* new SkillUpdatesAgentError({
        operation: "repository.check",
        message: `Required repository has no current branch: ${repository}`,
      });
    }
    const remoteDefault = (yield* executor.run(
      "git",
      ["-C", repository, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      { cwd: repository },
    )).trim();
    const expectedBranch = remoteDefault.replace(/^origin\//, "");
    if (!expectedBranch || branch !== expectedBranch) {
      return yield* new SkillUpdatesAgentError({
        operation: "repository.branch",
        message: `${repository} must be on ${expectedBranch || "its default branch"}; found ${branch}`,
      });
    }
    states.push({ path: repository, branch: expectedBranch });
  }
  return states;
});

const requireRepositoryState = Effect.fn(
  "SkillUpdatesAgent.requireRepositoryState",
)(function* (expected: readonly RepositoryState[]) {
  const current = yield* requireCleanRepositories(
    expected.map(({ path }) => path),
  );
  for (const [index, state] of current.entries()) {
    const wanted = expected[index];
    if (wanted && state.branch !== wanted.branch) {
      return yield* new SkillUpdatesAgentError({
        operation: "repository.restore",
        message: `${state.path} remained on ${state.branch}; expected ${wanted.branch}`,
      });
    }
  }
});

const inheritOrFail = Effect.fn("SkillUpdatesAgent.inheritOrFail")(function* (
  command: string,
  args: readonly string[],
  cwd: string,
) {
  const executor = yield* CommandExecutor;
  const exitCode = yield* executor.inherit(command, args, { cwd });
  if (exitCode === 0) return;
  return yield* new SkillUpdatesAgentError({
    operation: `${command} ${args.join(" ")}`,
    message: `Command exited with code ${exitCode}`,
  });
});

const validateSkillsRepository = Effect.fn(
  "SkillUpdatesAgent.validateSkillsRepository",
)(function* (skillsDir: string) {
  yield* inheritOrFail("python", ["scripts/validate.py"], skillsDir);
  yield* inheritOrFail(
    "python",
    ["-m", "unittest", "discover", "-s", "scripts", "-p", "test_*.py"],
    skillsDir,
  );
  yield* inheritOrFail(
    "mise",
    ["exec", "npm:skills", "--", "skills", "add", ".", "--list"],
    skillsDir,
  );
});

const publishCleanUpdate = Effect.fn("SkillUpdatesAgent.publishCleanUpdate")(
  function* (skillsDir: string, name: string) {
    const github = yield* GitHub;
    const branch = `skill-update/${name}`;
    yield* inheritOrFail(
      "git",
      ["checkout", "-B", branch, "origin/main"],
      skillsDir,
    );
    yield* inheritOrFail(
      "python",
      ["scripts/import_skill.py", name, "--apply"],
      skillsDir,
    );
    yield* validateSkillsRepository(skillsDir);
    yield* inheritOrFail("git", ["add", "--", "imports.json"], skillsDir);
    for (const path of [name, join("upstream", name)]) {
      if (existsSync(join(skillsDir, path))) {
        yield* inheritOrFail("git", ["add", "-A", "--", path], skillsDir);
      }
    }
    yield* inheritOrFail(
      "git",
      ["commit", "-m", `Update skill: ${name}`],
      skillsDir,
    );
    yield* inheritOrFail(
      "git",
      ["push", "--force-with-lease", "origin", branch],
      skillsDir,
    );

    const url = (yield* github.run([
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "url",
      "--jq",
      ".[0].url // empty",
      "--repo",
      "timmo001/skills",
    ])).trim();
    const title = `Update skill: ${name}`;
    if (url) {
      yield* github.run([
        "pr",
        "edit",
        url,
        "--title",
        title,
        "--add-assignee",
        "timmo001",
        "--repo",
        "timmo001/skills",
      ]);
    } else {
      yield* github.run([
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        branch,
        "--title",
        title,
        "--body",
        `Update the reviewed upstream snapshot for \`${name}\`.`,
        "--assignee",
        "timmo001",
        "--repo",
        "timmo001/skills",
      ]);
    }
    yield* github.run([
      "workflow",
      "run",
      "validate.yml",
      "--ref",
      branch,
      "--repo",
      "timmo001/skills",
    ]);
  },
);

const refreshDashboard = Effect.fn("SkillUpdatesAgent.refreshDashboard")(
  function* (skillsDir: string) {
    const executor = yield* CommandExecutor;
    const github = yield* GitHub;
    const configuredToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
    const token =
      configuredToken ??
      (yield* executor.run("gh", ["auth", "token"], { cwd: skillsDir })).trim();
    const markdown = yield* executor.run(
      "python",
      ["scripts/check_upstream.py", "--format", "markdown"],
      { cwd: skillsDir, env: { GH_TOKEN: token } },
    );
    const marker = "<!-- adapted-skill-updates -->";
    const number = (yield* github.run([
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,body",
      "--jq",
      `map(select(.body | contains("${marker}")))[0].number // empty`,
      "--repo",
      "timmo001/skills",
    ])).trim();
    yield* github.run([
      "issue",
      number ? "edit" : "create",
      ...(number ? [number] : []),
      "--title",
      "Skill updates",
      "--body",
      markdown,
      "--repo",
      "timmo001/skills",
    ]);
  },
);

const latestPullRequestNumber = Effect.fn(
  "SkillUpdatesAgent.latestPullRequestNumber",
)(function* () {
  const github = yield* GitHub;
  const raw = yield* github.run([
    "pr",
    "list",
    "--state",
    "all",
    "--limit",
    "1",
    "--json",
    "number",
    "--repo",
    "timmo001/skills",
  ]);
  const value = yield* Effect.try({
    try: () => JSON.parse(raw),
    catch: (error) =>
      new SkillUpdatesAgentError({
        operation: "pull-requests.json",
        message: String(error),
      }),
  });
  const pulls = yield* Schema.decodeUnknownEffect(PullRequestNumbers)(
    value,
  ).pipe(
    Effect.mapError(
      (error) =>
        new SkillUpdatesAgentError({
          operation: "pull-requests.decode",
          message: String(error),
        }),
    ),
  );
  return pulls[0]?.number ?? 0;
});

const validatePullRequestPolicy = Effect.fn(
  "SkillUpdatesAgent.validatePullRequestPolicy",
)(function* (afterNumber: number) {
  const github = yield* GitHub;
  const raw = yield* github.run([
    "pr",
    "list",
    "--state",
    "all",
    "--limit",
    "100",
    "--json",
    "number",
    "--repo",
    "timmo001/skills",
  ]);
  const value = yield* Effect.try({
    try: () => JSON.parse(raw),
    catch: (error) =>
      new SkillUpdatesAgentError({
        operation: "pull-requests.json",
        message: String(error),
      }),
  });
  const pulls = yield* Schema.decodeUnknownEffect(PullRequestNumbers)(
    value,
  ).pipe(
    Effect.mapError(
      (error) =>
        new SkillUpdatesAgentError({
          operation: "pull-requests.decode",
          message: String(error),
        }),
    ),
  );
  for (const { number } of pulls.filter(({ number }) => number > afterNumber)) {
    const detailsRaw = yield* github.run([
      "pr",
      "view",
      String(number),
      "--json",
      "title,state,mergedAt,assignees,autoMergeRequest,commits",
      "--repo",
      "timmo001/skills",
    ]);
    const detailsValue = yield* Effect.try({
      try: () => JSON.parse(detailsRaw),
      catch: (error) =>
        new SkillUpdatesAgentError({
          operation: "pull-request.json",
          message: String(error),
        }),
    });
    const details = yield* Schema.decodeUnknownEffect(PullRequestPolicy)(
      detailsValue,
    ).pipe(
      Effect.mapError(
        (error) =>
          new SkillUpdatesAgentError({
            operation: "pull-request.decode",
            message: String(error),
          }),
      ),
    );
    const title = details.title.match(/^SHA-only update: ([a-z0-9-]+)$/);
    const skill = title?.[1];
    const expectedCommit = skill ? `Record SHA-only update for ${skill}` : "";
    const assigned = details.assignees.some(
      ({ login }) => login === "timmo001",
    );
    const mergeReady = details.autoMergeRequest?.mergeMethod === "SQUASH";
    const commitsValid =
      details.commits.length === 1 &&
      details.commits[0]?.messageHeadline === expectedCommit;
    const patch = yield* github.run([
      "pr",
      "diff",
      String(number),
      "--patch",
      "--repo",
      "timmo001/skills",
    ]);
    if (
      !skill ||
      !assigned ||
      !mergeReady ||
      !commitsValid ||
      !isShaOnlySkillPatch(patch, skill)
    ) {
      return yield* new SkillUpdatesAgentError({
        operation: "pull-request.policy",
        message: `Pull request #${number} does not satisfy the SHA-only policy`,
      });
    }
  }
});

/** Run the repository update phase used by GitHub Actions. */
export const runGitHubSkillUpdates = Effect.fn("SkillUpdatesAgent.runGitHub")(
  function* (skillsDir: string) {
    const executor = yield* CommandExecutor;
    const directory = resolve(skillsDir);
    yield* inheritOrFail(
      "git",
      ["config", "user.name", "skill-updates[bot]"],
      directory,
    );
    yield* inheritOrFail(
      "git",
      ["config", "user.email", "skill-updates[bot]@users.noreply.github.com"],
      directory,
    );
    const updates = Effect.gen(function* () {
      const raw = yield* executor.run(
        "python",
        ["scripts/check_upstream.py", "--format", "json"],
        { cwd: directory },
      );
      const value = yield* Effect.try({
        try: () => JSON.parse(raw),
        catch: (error) =>
          new SkillUpdatesAgentError({
            operation: "updates.json",
            message: String(error),
          }),
      });
      const statuses = yield* Schema.decodeUnknownEffect(GitHubImportStatuses)(
        value,
      ).pipe(
        Effect.mapError(
          (error) =>
            new SkillUpdatesAgentError({
              operation: "updates.decode",
              message: String(error),
            }),
        ),
      );
      for (const name of cleanSkillUpdateNames(statuses)) {
        yield* publishCleanUpdate(directory, name);
      }
    });
    const result = yield* Effect.exit(updates);
    const cleanupResult = yield* Effect.exit(
      inheritOrFail("git", ["checkout", "--detach", "origin/main"], directory),
    );
    const dashboardResult = yield* Effect.exit(refreshDashboard(directory));
    if (result._tag === "Failure") {
      return yield* Effect.failCause(result.cause);
    }
    if (cleanupResult._tag === "Failure") {
      return yield* Effect.failCause(cleanupResult.cause);
    }
    if (dashboardResult._tag === "Failure") {
      return yield* Effect.failCause(dashboardResult.cause);
    }
  },
);

const processWithFallback = Effect.fn("SkillUpdatesAgent.processWithFallback")(
  function* (
    config: SkillUpdatesAgentConfig,
    prompt: string,
    repositoryState: readonly RepositoryState[],
    initialPullRequest: number,
  ) {
    const executor = yield* CommandExecutor;
    let lastMessage = "No model was attempted";
    for (const [index, model] of config.opencodeModels.entries()) {
      const name = skillUpdatesAgentModelArgument(model);
      const output: string[] = [];
      console.log(`[skill-updates-agent] running ${name}`);
      const result = yield* Effect.exit(
        executor
          .stream(
            config.opencodeCommand,
            [
              "run",
              "--auto",
              "--agent",
              config.opencodeAgent,
              "--model",
              name,
              "--title",
              "Scheduled skill updates",
              prompt,
            ],
            { cwd: config.repositories[0] },
          )
          .pipe(
            Stream.runForEach((line) =>
              Effect.sync(() => {
                console.log(line);
                output.push(line);
              }),
            ),
          ),
      );
      if (result._tag === "Success") {
        const status = skillUpdatesAgentResultStatus(output.join("\n"));
        if (status === "success") return;
        lastMessage =
          status === "failure"
            ? `Model ${name} reported failure`
            : `Model ${name} returned no valid status line`;
      } else {
        lastMessage = `Model ${name} failed: ${String(Cause.squash(result.cause))}`;
      }
      if (index < config.opencodeModels.length - 1) {
        yield* requireRepositoryState(repositoryState);
        const currentPullRequest = yield* latestPullRequestNumber();
        if (currentPullRequest > initialPullRequest) {
          return yield* new SkillUpdatesAgentError({
            operation: "opencode.partial",
            message: "A failed model attempt created pull requests",
          });
        }
        console.warn(`[skill-updates-agent] ${lastMessage}; trying fallback`);
      }
    }
    return yield* new SkillUpdatesAgentError({
      operation: "opencode.models",
      message: lastMessage,
    });
  },
);

/** Process the latest successful scheduled skill update workflow once. */
const runDeviceSkillUpdates = Effect.fn("SkillUpdatesAgent.runDevice")(
  function* (configPath?: string, runId?: string) {
    if (runId && envString(ENV.DOT_SKILL_UPDATES_AGENT_LOCKED) !== "1") {
      yield* inheritOrFail(
        "gh",
        [
          "run",
          "watch",
          runId,
          "--repo",
          "timmo001/skills",
          "--compact",
          "--exit-status",
          "--interval",
          "10",
        ],
        process.cwd(),
      );
    }
    const dotConfig = yield* Config;
    const resolvedPath = expandHomePath(
      configPath ??
        join(dotConfig.privateDotfiles ?? "", "skill-updates-agent.yml"),
    );
    if (!dotConfig.privateDotfiles && !configPath) {
      return yield* new SkillUpdatesAgentError({
        operation: "config.resolve",
        message: "Private dotfiles are unavailable",
      });
    }
    const config = yield* loadConfig(resolvedPath);
    if (envString(ENV.DOT_SKILL_UPDATES_AGENT_LOCKED) !== "1") {
      return yield* runWithProcessLock(resolvedPath, config.stateFile, runId);
    }
    const run = runId
      ? yield* fetchRunById(runId)
      : yield* fetchLatestRun(config.workflowApi);
    if (completedRun(config.stateFile) === String(run.id)) {
      console.log(`Workflow run ${run.id} has already been processed`);
      return;
    }
    const repositoryState = yield* requireCleanRepositories(
      config.repositories,
    );
    const initialPullRequest = yield* latestPullRequestNumber();
    yield* processWithFallback(
      config,
      skillUpdatesAgentPrompt(config, run),
      repositoryState,
      initialPullRequest,
    );
    yield* requireRepositoryState(repositoryState);
    yield* validatePullRequestPolicy(initialPullRequest);
    yield* refreshDashboard(config.repositories[0]);
    yield* Effect.sync(() => recordCompletedRun(config.stateFile, run.id));
    console.log(`Processed workflow run ${run.id}`);
  },
);

/** Run skill update automation in GitHub Actions or on a local device. */
export const skillUpdatesAgent = (options: {
  readonly mode: "github" | "device";
  readonly configPath?: string;
  readonly runId?: string;
  readonly skillsDir?: string;
}) =>
  options.mode === "github"
    ? runGitHubSkillUpdates(options.skillsDir ?? process.cwd())
    : runDeviceSkillUpdates(options.configPath, options.runId);
