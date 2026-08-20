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
import { dirname, join } from "path";
import { ENV, envString } from "../lib/env.js";
import { expandHomePath } from "../lib/paths.js";
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

const WorkflowRuns = Schema.Struct({
  workflow_runs: Schema.Array(
    Schema.Struct({
      id: Schema.Int.check(Schema.isGreaterThan(0)),
      conclusion: Schema.NullOr(Schema.String),
      html_url: Schema.String,
    }),
  ),
});

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
  const value = yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(workflowApi, {
        signal,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      return response.json();
    },
    catch: (error) =>
      new SkillUpdatesAgentError({
        operation: "workflow.fetch",
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
  function* (configPath: string, stateFile: string) {
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
      "--config",
      configPath,
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
  const status = output
    .split("\n")
    .map((line) => line.trim())
    .findLast(
      (line) =>
        line.startsWith(SUCCESS_PREFIX) || line.startsWith(FAILURE_PREFIX),
    );
  if (status?.startsWith(SUCCESS_PREFIX)) return "success";
  if (status?.startsWith(FAILURE_PREFIX)) return "failure";
  return null;
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
    states.push({ path: repository, branch });
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

const processWithFallback = Effect.fn("SkillUpdatesAgent.processWithFallback")(
  function* (
    config: SkillUpdatesAgentConfig,
    prompt: string,
    repositoryState: readonly RepositoryState[],
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
export const skillUpdatesAgent = Effect.fn("SkillUpdatesAgent.run")(function* (
  configPath?: string,
) {
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
    return yield* runWithProcessLock(resolvedPath, config.stateFile);
  }
  const run = yield* fetchLatestRun(config.workflowApi);
  if (completedRun(config.stateFile) === String(run.id)) {
    console.log(`Workflow run ${run.id} has already been processed`);
    return;
  }
  const repositoryState = yield* requireCleanRepositories(config.repositories);
  yield* processWithFallback(
    config,
    skillUpdatesAgentPrompt(config, run),
    repositoryState,
  );
  yield* requireRepositoryState(repositoryState);
  yield* Effect.sync(() => recordCompletedRun(config.stateFile, run.id));
  console.log(`Processed workflow run ${run.id}`);
});
