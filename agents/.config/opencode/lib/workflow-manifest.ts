export interface WorkflowRun {
  readonly databaseId: number;
  readonly conclusion: string;
  readonly createdAt: string;
  readonly headSha: string;
  readonly name: string;
  readonly status: string;
  readonly url: string;
  readonly workflowDatabaseId: number;
}

export const REGISTRATION_RETRY_INTERVAL_MS = 2_000;
export const REGISTRATION_MAX_ATTEMPTS = 16;

export const resolveRunsWithRetry = async ({
  sha,
  listRuns,
  sleep = (milliseconds: number) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = REGISTRATION_MAX_ATTEMPTS,
  retryIntervalMs = REGISTRATION_RETRY_INTERVAL_MS,
}: {
  readonly sha: string;
  readonly listRuns: () => Promise<readonly WorkflowRun[]>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly maxAttempts?: number;
  readonly retryIntervalMs?: number;
}) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const runs = (await listRuns()).filter((run) => run.headSha === sha);
    if (runs.length > 0) {
      return { status: "resolved" as const, attempts: attempt, runs };
    }
    if (attempt < maxAttempts) await sleep(retryIntervalMs);
  }

  return {
    status: "unresolved" as const,
    attempts: maxAttempts,
    runs: [] as readonly WorkflowRun[],
  };
};
