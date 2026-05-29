import { Clock, Context, Effect, Layer, PubSub, Stream } from "effect";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  WorkflowRepoRuns,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowState,
} from "../types.js";
import { CommandExecutor } from "./CommandExecutor.js";
import { Config } from "./Config.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER ?? ""}`;
const RUN_LIMIT = 100;
const log = (msg: string) => console.error(`[dot:WorkflowRuns] ${msg}`);

interface WorkflowRunsService {
  /** Subscribe to workflow run state snapshots */
  readonly subscribe: () => Stream.Stream<WorkflowState>;
  /** Refresh watched repo workflow runs from GitHub */
  readonly refresh: () => Effect.Effect<void>;
  /** Return the most recent workflow run state */
  readonly getState: () => Effect.Effect<WorkflowState>;
}

interface WatchlistResult {
  readonly path: string;
  readonly slugs: readonly string[];
  readonly message?: string;
}

interface CommitInfo {
  readonly sha: string;
  readonly subject: string | null;
  readonly url: string | null;
}

interface GhRunRecord {
  readonly databaseId?: unknown;
  readonly status?: unknown;
  readonly conclusion?: unknown;
  readonly workflowName?: unknown;
  readonly displayTitle?: unknown;
  readonly url?: unknown;
  readonly event?: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
}

/** Effect service for {@link WorkflowRunsService} */
export class WorkflowRuns extends Context.Service<
  WorkflowRuns,
  WorkflowRunsService
>()("WorkflowRuns") {
  static readonly layer = Layer.effect(
    WorkflowRuns,
    Effect.gen(function* () {
      log("Initialising WorkflowRuns...");
      const config = yield* Config;
      const executor = yield* CommandExecutor;
      const pubsub = yield* PubSub.unbounded<WorkflowState>();

      const initialWatchlist = readWatchlist(getWatchlistPath(config));
      let currentState = buildState(
        initialWatchlist.slugs.map(emptyRepo),
        new Date(yield* Clock.currentTimeMillis),
        false,
        false,
        initialWatchlist.message,
      );

      const fetchRepoRuns = Effect.fn("WorkflowRuns.fetchRepoRuns")(function* (
        slug: string,
      ) {
        const defaultBranch = (yield* executor.run("gh", [
          "api",
          `repos/${slug}`,
          "--jq",
          ".default_branch",
        ])).trim();

        if (!defaultBranch) {
          return {
            ...emptyRepo(slug),
            error: "default branch not found",
          };
        }

        const commit = yield* getHeadCommit(slug, defaultBranch);
        const runs = yield* getRuns(slug, defaultBranch, commit.sha);

        return {
          slug,
          defaultBranch,
          headSha: commit.sha,
          commitSubject: commit.subject,
          commitUrl: commit.url,
          runs,
        };
      });

      const getHeadCommit = Effect.fn("WorkflowRuns.getHeadCommit")(function* (
        slug: string,
        branch: string,
      ) {
        const raw = yield* executor.run("gh", [
          "api",
          `repos/${slug}/commits/${encodeURIComponent(branch)}`,
          "--jq",
          '{sha: .sha, subject: (.commit.message | split("\\n")[0]), url: .html_url}',
        ]);
        const record = yield* Effect.try({
          try: () => parseJsonRecord(raw),
          catch: (error) =>
            error instanceof Error ? error : new Error(String(error)),
        });
        const sha = stringField(record, "sha");

        if (!sha) {
          return yield* Effect.fail(new Error("head commit not found"));
        }

        return {
          sha,
          subject: nullableStringField(record, "subject"),
          url: nullableStringField(record, "url"),
        };
      });

      const getRuns = Effect.fn("WorkflowRuns.getRuns")(function* (
        slug: string,
        branch: string,
        sha: string,
      ) {
        const raw = yield* executor.run("gh", [
          "run",
          "list",
          "--repo",
          slug,
          "--branch",
          branch,
          "--commit",
          sha,
          "--limit",
          String(RUN_LIMIT),
          "--json",
          "databaseId,status,conclusion,workflowName,displayTitle,url,event,createdAt,updatedAt",
        ]);
        const parsed = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (error) =>
            error instanceof Error ? error : new Error(String(error)),
        });
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isRunRecord).map(toWorkflowRun);
      });

      const refresh = Effect.gen(function* () {
        log("Refreshing workflow runs...");
        const watchlist = readWatchlist(getWatchlistPath(config));
        currentState = buildState(
          watchlist.slugs.map(emptyRepo),
          new Date(yield* Clock.currentTimeMillis),
          true,
          currentState.loaded,
          watchlist.message,
        );
        yield* PubSub.publish(pubsub, currentState);

        if (watchlist.slugs.length === 0) {
          currentState = buildState(
            [],
            new Date(yield* Clock.currentTimeMillis),
            false,
            true,
            watchlist.message,
          );
          yield* PubSub.publish(pubsub, currentState);
          return;
        }

        const hasGh = (yield* executor.exitCode("which", ["gh"])) === 0;
        if (!hasGh) {
          currentState = buildState(
            watchlist.slugs.map((slug) => ({
              ...emptyRepo(slug),
              error: "gh CLI not found",
            })),
            new Date(yield* Clock.currentTimeMillis),
            false,
            true,
            watchlist.message,
          );
          yield* PubSub.publish(pubsub, currentState);
          return;
        }

        const repos = yield* Effect.all(
          watchlist.slugs.map((slug) =>
            fetchRepoRuns(slug).pipe(
              Effect.catch((error) =>
                Effect.succeed({
                  ...emptyRepo(slug),
                  error: formatError(error),
                }),
              ),
            ),
          ),
          { concurrency: 4 },
        );

        currentState = buildState(
          repos,
          new Date(yield* Clock.currentTimeMillis),
          false,
          true,
          watchlist.message,
        );
        yield* PubSub.publish(pubsub, currentState);
        log(`Refresh complete: ${repos.length} watched repos`);
      }).pipe(
        Effect.withSpan("WorkflowRuns.refresh"),
        Effect.catch((error) => {
          log(`Refresh failed: ${formatError(error)}`);
          currentState = buildState(
            currentState.repos,
            new Date(),
            false,
            currentState.loaded,
            formatError(error),
          );
          return PubSub.publish(pubsub, currentState).pipe(Effect.asVoid);
        }),
      );

      return {
        subscribe: () => Stream.fromPubSub(pubsub),
        refresh: () => refresh,
        getState: () => Effect.succeed(currentState),
      };
    }),
  );
}

function getWatchlistPath(config: { readonly privateDotfiles: string | null }) {
  return (
    process.env.DOT_WORKFLOW_WATCH_REPOS_FILE ??
    join(
      config.privateDotfiles ?? join(HOME, ".config", "dotfiles-private"),
      ".git-workflow-watch-repos",
    )
  );
}

function readWatchlist(path: string): WatchlistResult {
  if (!existsSync(path)) {
    return {
      path,
      slugs: [],
      message: `Watchlist missing: ${displayPath(path)}`,
    };
  }

  try {
    const seen = new Set<string>();
    const slugs: string[] = [];
    const content = readFileSync(path, "utf-8");

    for (const rawLine of content.split("\n")) {
      const line = rawLine.split("#", 1)[0]?.trim() ?? "";
      if (!line) continue;

      const slug = parseGithubRepoSlug(line);
      if (slug && !seen.has(slug)) {
        seen.add(slug);
        slugs.push(slug);
      }
    }

    return { path, slugs };
  } catch (error) {
    return {
      path,
      slugs: [],
      message: `Could not read ${displayPath(path)}: ${formatError(error)}`,
    };
  }
}

function parseGithubRepoSlug(value: string): string | null {
  let slug = value.trim();
  if (slug.startsWith("git@github.com:")) {
    slug = slug.slice("git@github.com:".length);
  } else if (slug.startsWith("ssh://git@github.com/")) {
    slug = slug.slice("ssh://git@github.com/".length);
  } else if (slug.startsWith("https://github.com/")) {
    slug = slug.slice("https://github.com/".length);
  } else if (slug.startsWith("http://github.com/")) {
    slug = slug.slice("http://github.com/".length);
  } else if (slug.startsWith("git://github.com/")) {
    slug = slug.slice("git://github.com/".length);
  }

  slug = slug.replace(/\.git$/, "").replace(/\/$/, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug) ? slug : null;
}

function emptyRepo(slug: string): WorkflowRepoRuns {
  return {
    slug,
    defaultBranch: null,
    headSha: null,
    commitSubject: null,
    commitUrl: null,
    runs: [],
  };
}

function buildState(
  repos: readonly WorkflowRepoRuns[],
  lastChecked: Date,
  loading: boolean,
  loaded: boolean,
  message?: string,
): WorkflowState {
  return {
    repos,
    lastChecked,
    loading,
    loaded,
    ...(message && { message }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("expected JSON object");
  }
  return parsed;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function nullableStringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRunRecord(value: unknown): value is GhRunRecord {
  return isRecord(value);
}

function toWorkflowRun(record: GhRunRecord): WorkflowRun {
  const id =
    typeof record.databaseId === "number" ||
    typeof record.databaseId === "string"
      ? String(record.databaseId)
      : "";
  const workflowName = stringValue(record.workflowName) || "Unnamed workflow";
  const displayTitle = stringValue(record.displayTitle) || workflowName;

  return {
    id,
    workflowName,
    displayTitle,
    status: normalizeStatus(stringValue(record.status)),
    conclusion: nullableStringValue(record.conclusion),
    url: stringValue(record.url),
    event: stringValue(record.event),
    createdAt: nullableStringValue(record.createdAt),
    updatedAt: nullableStringValue(record.updatedAt),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeStatus(status: string): WorkflowRunStatus {
  switch (status) {
    case "completed":
    case "in_progress":
    case "queued":
    case "requested":
    case "waiting":
    case "pending":
      return status;
    default:
      return "unknown";
  }
}

function formatError(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { readonly stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.length > 0) return stderr;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function displayPath(path: string): string {
  return path.startsWith(HOME) ? `~${path.slice(HOME.length)}` : path;
}
