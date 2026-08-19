/**
 * @file Resolves pushed GitHub Actions runs into a compact watcher manifest.
 */

import { $ } from "bun";
import { Plugin } from "@opencode-ai/plugin";
import { Schema } from "effect";
import {
  REGISTRATION_RETRY_INTERVAL_MS,
  resolveRunsWithRetry,
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

const parse = <T>(value: string): T => JSON.parse(value) as T;

export default Plugin.define({
  id: "workflow-manifest",
  setup: async (context) => {
    await context.tool.transform((tools) => {
      tools.add({
        name: "workflow_manifest",
        description:
          "Resolve one pushed SHA into compact, immutable quick and full GitHub Actions watcher manifests. Use on the host after push instead of listing runs/jobs manually or delegating discovery.",
        input,
        options: { codemode: false },
        async execute({ repositoryPath, sha, pushedFiles }, toolContext) {
          await toolContext.progress({ title: `Resolve workflows for ${sha.slice(0, 8)}` });

          const repository = String(
            await $`timeout 5s gh repo view --json nameWithOwner --jq .nameWithOwner`
              .cwd(repositoryPath)
              .text(),
          ).trim();
          const branch = String(
            await $`git branch --show-current`.cwd(repositoryPath).text(),
          ).trim();
          const workflows = parse<Workflow[]>(
            await $`timeout 5s gh workflow list --all --limit 100 --json id,name,path`
              .cwd(repositoryPath)
              .text(),
          );
          const workflowPaths = new Map(
            workflows.map((workflow) => [workflow.id, workflow.path]),
          );
          const fullSha = String(
            await $`git rev-parse ${`${sha}^{commit}`}`
              .cwd(repositoryPath)
              .text(),
          ).trim();
          const registration = await resolveRunsWithRetry({
            sha: fullSha,
            listRuns: async () =>
              parse<WorkflowRun[]>(
                await $`timeout 5s gh run list --commit ${fullSha} --limit 100 --json databaseId,conclusion,createdAt,headSha,name,status,url,workflowDatabaseId`
                  .cwd(repositoryPath)
                  .text(),
              ),
          });

          const resolvedRuns = await Promise.all(
            registration.runs.map(async (run) => {
              const detail = parse<{ readonly jobs: Job[] }>(
                await $`timeout 5s gh run view ${run.databaseId} --json jobs`
                  .cwd(repositoryPath)
                  .text(),
              );
              return {
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
              };
            }),
          );
          const quickRuns = resolvedRuns
            .map((run) => ({
              ...run,
              jobs: run.jobs.filter(
                (job) => QUICK_JOB.test(job.name) && !SLOW_JOB.test(job.name),
              ),
            }))
            .filter((run) => run.jobs.length > 0);
          const fullRuns = resolvedRuns
            .map((run) => ({
              ...run,
              jobs: run.jobs.filter(
                (job) => !QUICK_JOB.test(job.name) || SLOW_JOB.test(job.name),
              ),
            }))
            .filter((run) => run.jobs.length > 0);

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
              worktreeStateAtDelegation: String(
                await $`git status --short`.cwd(repositoryPath).text(),
              ).trim()
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
        },
      });
    });
  },
});
