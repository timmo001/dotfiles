/**
 * @file Resolves pushed GitHub Actions runs into a compact watcher manifest.
 */

import { $ } from "bun";
import { Plugin } from "@opencode-ai/plugin/effect";
import { Tool } from "@opencode-ai/schema/tool";
import { Effect, Schema } from "effect";
import {
  REGISTRATION_MAX_ATTEMPTS,
  REGISTRATION_RETRY_INTERVAL_MS,
  type WorkflowRun,
} from "../lib/workflow-manifest";

interface Workflow {
  readonly id: number;
  readonly name: string;
  readonly path: string;
}

interface Job {
  readonly conclusion: string;
  readonly databaseId: number;
  readonly name: string;
  readonly status: string;
  readonly url: string;
}

const QUICK_JOB =
  /(?:lint|format|static|type|unit|regression|shellcheck|actionlint|jsonlint|yamllint|markdown)/i;
const SLOW_JOB =
  /(?:build|e2e|end.to.end|deploy|release|codeql|mise toolchain)/i;

const input = Schema.Struct({
  repositoryPath: Schema.String,
  sha: Schema.String,
  pushedFiles: Schema.Array(Schema.String),
});

// SAFETY: Callers provide the matching typed `gh --json` response contract.
const parse = <T>(value: string): T => JSON.parse(value) as T;

const external = <T>(run: () => Promise<T>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      new Tool.Error({
        message: error instanceof Error ? error.message : "External command failed",
        error,
      }),
  });

export const resolveRunsWithRetryEffect = <E>({
  sha,
  listRuns,
  maxAttempts = REGISTRATION_MAX_ATTEMPTS,
  retryIntervalMs = REGISTRATION_RETRY_INTERVAL_MS,
}: {
  readonly sha: string;
  readonly listRuns: () => Effect.Effect<readonly WorkflowRun[], E>;
  readonly maxAttempts?: number;
  readonly retryIntervalMs?: number;
}) =>
  Effect.gen(function* () {
    let previousRunIDs = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const runs = (yield* listRuns()).filter((run) => run.headSha === sha);
      const runIDs = runs
        .map((run) => run.databaseId)
        .sort((left, right) => left - right)
        .join(",");
      if (runIDs && runIDs === previousRunIDs) {
        return { status: "resolved" as const, attempts: attempt, runs };
      }
      previousRunIDs = runIDs;
      if (attempt < maxAttempts) yield* Effect.sleep(retryIntervalMs);
    }

    return {
      status: "unresolved" as const,
      attempts: maxAttempts,
      runs: [] satisfies readonly WorkflowRun[],
    };
  });

export default Plugin.define({
  id: "workflow-manifest",
  effect: (context) =>
    Effect.gen(function* () {
      yield* context.tool.transform((tools) => {
        tools.add({
          name: "workflow_manifest",
          description:
            "Resolve one pushed SHA into compact, immutable quick and full GitHub Actions watcher manifests. Use on the host after push instead of listing runs/jobs manually or delegating discovery.",
          input,
          options: { codemode: false },
          execute: ({ repositoryPath, sha, pushedFiles }, toolContext) =>
            Effect.gen(function* () {
              yield* toolContext.progress({
                title: `Resolve workflows for ${sha.slice(0, 8)}`,
              });
              const repository = String(
                yield* external(() =>
                  $`timeout 5s gh repo view --json nameWithOwner --jq .nameWithOwner`
                    .cwd(repositoryPath)
                    .text(),
                ),
              ).trim();
              const branch = String(
                yield* external(() =>
                  $`git branch --show-current`.cwd(repositoryPath).text(),
                ),
              ).trim();
              const workflows = parse<Workflow[]>(
                yield* external(() =>
                  $`timeout 5s gh workflow list --all --limit 100 --json id,name,path`
                    .cwd(repositoryPath)
                    .text(),
                ),
              );
              const workflowPaths = new Map(
                workflows.map((workflow) => [workflow.id, workflow.path]),
              );
              const fullSha = String(
                yield* external(() =>
                  $`git rev-parse ${`${sha}^{commit}`}`
                    .cwd(repositoryPath)
                    .text(),
                ),
              ).trim();
              const registration = yield* resolveRunsWithRetryEffect({
                sha: fullSha,
                listRuns: () =>
                  external(() =>
                    $`timeout 5s gh run list --commit ${fullSha} --limit 100 --json databaseId,conclusion,createdAt,headSha,name,status,url,workflowDatabaseId`
                      .cwd(repositoryPath)
                      .text(),
                  ).pipe(Effect.map(parse<WorkflowRun[]>)),
              });

              const resolvedRuns = yield* Effect.all(
                registration.runs.map((run) =>
                  external(() =>
                    $`timeout 5s gh run view ${run.databaseId} --json jobs`
                      .cwd(repositoryPath)
                      .text(),
                  ).pipe(
                    Effect.map(parse<{ readonly jobs: Job[] }>),
                    Effect.map((detail) => ({
                      name: run.name,
                      path: workflowPaths.get(run.workflowDatabaseId) ?? null,
                      runId: run.databaseId,
                      url: run.url,
                      sha: run.headSha,
                      status: run.status,
                      conclusion: run.conclusion || null,
                      createdAt: run.createdAt,
                      jobs: detail.jobs.map((job) => ({
                        name: job.name,
                        jobId: job.databaseId,
                        url: job.url,
                        status: job.status,
                        conclusion: job.conclusion || null,
                      })),
                    })),
                  ),
                ),
                { concurrency: "unbounded" },
              );
              const quickRuns = resolvedRuns
                .map((run) => ({
                  ...run,
                  jobs: run.jobs.filter(
                    (job) =>
                      QUICK_JOB.test(job.name) && !SLOW_JOB.test(job.name),
                  ),
                }))
                .filter((run) => run.jobs.length > 0);
              const fullRuns = resolvedRuns
                .map((run) => ({
                  ...run,
                  jobs: run.jobs.filter(
                    (job) =>
                      !QUICK_JOB.test(job.name) || SLOW_JOB.test(job.name),
                  ),
                }))
                .filter((run) => run.jobs.length > 0);

              const worktreeStatus = yield* external(() =>
                $`git status --short`.cwd(repositoryPath).text(),
              );
              return {
                content: JSON.stringify({
                  repositoryPath,
                  repository,
                  branch,
                  sha: fullSha,
                  registration: {
                    status: registration.status,
                    attempts: registration.attempts,
                    waitedMs:
                      (registration.attempts - 1) *
                      REGISTRATION_RETRY_INTERVAL_MS,
                    retry: registration.status === "unresolved",
                  },
                  pushedFiles,
                  fixBoundary: pushedFiles,
                  worktreeStateAtDelegation: String(worktreeStatus).trim()
                    ? "dirty"
                    : "clean",
                  quick: {
                    mode: "fail-fast-fix",
                    timeoutMinutes: 15,
                    runs: quickRuns,
                  },
                  full: {
                    mode: "watch-only",
                    timeoutMinutes: 45,
                    runs: fullRuns,
                  },
                }),
              };
            }),
        });
      });
    }),
});
