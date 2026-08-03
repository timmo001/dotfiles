/**
 * @file Resolves pushed GitHub Actions runs into a compact watcher manifest.
 */

import { tool, type Plugin } from "@opencode-ai/plugin";

interface Run {
  readonly databaseId: number;
  readonly conclusion: string;
  readonly createdAt: string;
  readonly headSha: string;
  readonly name: string;
  readonly status: string;
  readonly url: string;
  readonly workflowDatabaseId: number;
}

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
const SLOW_JOB = /(?:build|e2e|end.to.end|deploy|release|codeql|mise toolchain)/i;

const parse = <T>(value: string): T => JSON.parse(value) as T;

export const WorkflowManifestPlugin = (async ({ $ }) => ({
  tool: {
    workflow_manifest: tool({
      description:
        "Resolve one pushed SHA into compact, immutable quick and full GitHub Actions watcher manifests. Use once on the host after push instead of listing runs/jobs manually or delegating discovery.",
      args: {
        repositoryPath: tool.schema
          .string()
          .describe("Absolute local repository path"),
        sha: tool.schema.string().describe("Full pushed commit SHA"),
        pushedFiles: tool.schema
          .array(tool.schema.string())
          .describe("Files included in the pushed changeset"),
      },
      async execute({ repositoryPath, sha, pushedFiles }, context) {
        context.metadata({ title: `Resolve workflows for ${sha.slice(0, 8)}` });

        const repository = String(
          await $`gh repo view --json nameWithOwner --jq .nameWithOwner`
            .cwd(repositoryPath)
            .text(),
        ).trim();
        const branch = String(
          await $`git branch --show-current`.cwd(repositoryPath).text(),
        ).trim();
        const workflows = parse<Workflow[]>(
          await $`gh workflow list --all --limit 100 --json id,name,path`
            .cwd(repositoryPath)
            .text(),
        );
        const workflowPaths = new Map(
          workflows.map((workflow) => [workflow.id, workflow.path]),
        );
        const runs = parse<Run[]>(
          await $`gh run list --commit ${sha} --limit 100 --json databaseId,conclusion,createdAt,headSha,name,status,url,workflowDatabaseId`
            .cwd(repositoryPath)
            .text(),
        ).filter((run) => run.headSha === sha);

        const resolvedRuns = await Promise.all(
          runs.map(async (run) => {
            const detail = parse<{ readonly jobs: Job[] }>(
              await $`gh run view ${run.databaseId} --json jobs`
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

        return JSON.stringify({
          repositoryPath,
          repository,
          branch,
          sha,
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
        });
      },
    }),
  },
  "permission.ask": async (input, output) => {
    if (input.permission === "workflow_manifest") output.status = "allow";
  },
})) satisfies Plugin;

export default WorkflowManifestPlugin;
