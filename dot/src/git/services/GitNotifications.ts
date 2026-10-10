import { NodeServices } from "@effect/platform-node";
import { Api } from "@timmo001/effect-gh";
import { join } from "node:path";
import { Clock, Context, Effect, FileSystem, Layer, Schema } from "effect";
import type {
  GitNotificationAction,
  GitNotificationActionResult,
  GitNotificationQueryOptions,
  GitNotificationState,
  GitNotificationSubjectType,
  GitNotificationThread,
  GitNotificationReview,
  GitNotificationDismissal,
  GitNotificationCategory,
} from "../../types.js";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import {
  gitRepoNotificationsActive,
  managedGitRepos,
  managedGitRepoForGitHub,
} from "../../services/GitConfig.js";
import { valuesLookLikeBotActivity } from "./botActivity.js";
import { GitHub, type GitHubService } from "./GitHub.js";
import { notificationReasonIsImportant } from "./notificationStatus.js";
import { managedRepoGitHubSlugs } from "./repoRelations.js";
import { formatGhError, nullableStringValue, stringValue } from "./record.js";
import { ENV, envString } from "../../lib/env.js";
import { writeFileAtomic } from "../../lib/atomicWrite.js";
import { CACHE_DIR } from "../../lib/paths.js";
import { isWorkTime } from "../../lib/workTime.js";
import type { JsonObject, JsonValue } from "../../lib/schema.js";
import { inspectNotification } from "./notificationReview.js";

const NOTIFICATION_LIMIT = 100;

const NotificationRecord = Schema.Struct({
  id: Schema.NonEmptyString,
  unread: Schema.Boolean,
  reason: Schema.NonEmptyString,
  updated_at: Schema.NonEmptyString,
  last_read_at: Schema.NullOr(Schema.String),
  url: Schema.NonEmptyString,
  repository: Schema.Struct({
    full_name: Schema.NonEmptyString,
    html_url: Schema.NonEmptyString,
  }),
  subject: Schema.Struct({
    title: Schema.String,
    type: Schema.NonEmptyString,
    url: Schema.NullOr(Schema.String),
    latest_comment_url: Schema.NullOr(Schema.String),
  }),
});

const DEBUG = !!envString(ENV.DOT_DEBUG);

const BOT_CACHE_FILE = join(CACHE_DIR, "dot", "notification-bots.json");

const BotCache = Schema.Record(Schema.String, Schema.Boolean);

const botCacheKey = (thread: GitNotificationThread) =>
  `${thread.id}:${thread.updatedAt ?? ""}`;

// Bot checks can call the GitHub API per thread, so results are kept until the thread updates.
const readBotCache = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(BOT_CACHE_FILE);

  return yield* Schema.decodeEffect(Schema.fromJsonString(BotCache))(text);
}).pipe(
  Effect.orElseSucceed((): Readonly<Record<string, boolean>> => ({})),
  Effect.provide(NodeServices.layer),
);

const writeBotCache = (
  previous: Readonly<Record<string, boolean>>,
  next: Readonly<Record<string, boolean>>,
) =>
  JSON.stringify(previous) === JSON.stringify(next)
    ? Effect.void
    : Effect.try(() =>
        writeFileAtomic(BOT_CACHE_FILE, JSON.stringify(next), {
          mode: 0o600,
          createDirectory: true,
        }),
      ).pipe(Effect.ignore);

const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:GitNotifications] ${msg}`);
};

/** Domain error for GitHub notification operations. */
export class GitNotificationError extends Schema.TaggedError<GitNotificationError>()(
  "GitNotificationError",
  {
    message: Schema.String,
    threadId: Schema.optional(Schema.String),
    action: Schema.optional(Schema.String),
  },
) {}

/** Service interface for the authenticated user's GitHub notification inbox. */
interface GitNotificationsService {
  /** Inspect every unread notification for the two dismissal passes. */
  readonly review: (
    repos?: readonly string[],
  ) => Effect.Effect<readonly GitNotificationReview[], GitNotificationError>;
  /** Revalidate displayed selections and dismiss only the selected pass. */
  readonly dismiss: (
    entries: readonly GitNotificationReview[],
    category: GitNotificationCategory,
  ) => Effect.Effect<readonly GitNotificationDismissal[]>;
  /** Fetch the current notification inbox state from GitHub. */
  readonly query: (
    opts?: GitNotificationQueryOptions,
  ) => Effect.Effect<GitNotificationState>;
  /** Mark a notification thread as read. */
  readonly markRead: (
    threadId: string,
  ) => Effect.Effect<GitNotificationActionResult, GitNotificationError>;
}

type GhNotificationRecord = JsonObject;

/** Effect service for {@link GitNotificationsService}. */
export class GitNotifications extends Context.Service<
  GitNotifications,
  GitNotificationsService
>()("GitNotifications") {
  static readonly layer = Layer.effect(
    GitNotifications,
    Effect.gen(function* () {
      log("Initialising GitNotifications...");
      const github = yield* GitHub;
      const config = yield* Config;
      const executor = yield* CommandExecutor;

      const fetchNotificationPage = Effect.fn(
        "GitNotifications.fetchNotificationPage",
      )(function* (opts?: GitNotificationQueryOptions) {
        const pages = yield* github.read(
          "notifications",
          Api.pages(
            { endpoint: notificationEndpoint(opts), method: "GET" },
            Schema.Array(NotificationRecord),
          ),
        );

        const seen = new Set<string>();

        return pages
          .flat()
          .filter((thread) => {
            if (seen.has(thread.id)) return false;
            seen.add(thread.id);

            return true;
          })
          .map(toNotificationThread);
      });

      const fetchThreads = Effect.fn("GitNotifications.fetchThreads")(
        function* (opts?: GitNotificationQueryOptions) {
          return yield* fetchNotificationPage(normalizeQuery(opts));
        },
      );

      const query = (opts?: GitNotificationQueryOptions) =>
        Effect.gen(function* () {
          const normalizedQuery = normalizeQuery(opts);

          const hasGh = yield* github.isAvailable;

          if (!hasGh) {
            return buildState(
              [],
              0,
              new Date(yield* Clock.currentTimeMillis),
              normalizedQuery,
              "gh CLI not found",
            );
          }

          const allThreads = yield* fetchThreads(normalizedQuery);

          const filtered = yield* filterBarThreadsIfNeeded(
            allThreads,
            normalizedQuery,
          );

          log(
            `Query complete: ${filtered.threads.length} notification threads`,
          );

          return buildState(
            filtered.threads,
            allThreads.length,
            new Date(yield* Clock.currentTimeMillis),
            normalizedQuery,
            undefined,
            filtered.inbox,
          );
        }).pipe(
          Effect.withSpan("GitNotifications.query"),
          Effect.catch((error) =>
            Effect.gen(function* () {
              return buildState(
                [],
                0,
                new Date(yield* Clock.currentTimeMillis),
                normalizeQuery(opts),
                formatGhError(error),
              );
            }),
          ),
        );

      const filterBarThreadsIfNeeded = (
        threads: readonly GitNotificationThread[],
        query: GitNotificationQueryOptions,
      ) => {
        if (!query.barFilter) {
          return Effect.succeed({ inbox: threads, threads });
        }

        if (!config.canUsePrivate || !config.gitConfig.valid)
          return Effect.succeed({ inbox: threads, threads: [] });

        return Effect.gen(function* () {
          const workTimeActive =
            threads.length > 0 &&
            managedGitRepos(config.gitConfig).some(
              (repo) =>
                repo.notifications.enabled &&
                repo.notifications.schedule === "work",
            )
              ? yield* isWorkTime((message) =>
                  Effect.sync(() => log(message)),
                ).pipe(
                  Effect.provideService(Config, config),
                  Effect.provide(NodeServices.layer),
                )
              : false;

          const now = new Date(yield* Clock.currentTimeMillis);
          const botCache = yield* readBotCache;
          const nextBotCache: Record<string, boolean> = {};

          const filtered = yield* Effect.forEach(
            threads,
            (thread) =>
              includeBarThread(
                thread,
                now,
                workTimeActive,
                botCache,
                nextBotCache,
              ),
            { concurrency: 4 },
          );

          yield* writeBotCache(botCache, nextBotCache);

          // The inbox keeps hidden threads, with bot activity marked where it was checked.
          return {
            inbox: filtered.map((entry) => entry.thread),
            threads: filtered
              .filter((entry) => entry.shown)
              .map((entry) => entry.thread),
          };
        });
      };

      const includeBarThread = (
        thread: GitNotificationThread,
        now: Date,
        workTimeActive: boolean,
        botCache: Readonly<Record<string, boolean>>,
        nextBotCache: Record<string, boolean>,
      ) =>
        Effect.gen(function* () {
          const repo = yield* managedRepoForNotification(thread.repo);

          if (!repo) return { thread, shown: false };

          if (!gitRepoNotificationsActive(repo, now, workTimeActive))
            return { thread, shown: false };

          const key = botCacheKey(thread);

          const bot =
            botCache[key] ??
            (yield* notificationThreadLooksBot(thread, github));

          nextBotCache[key] = bot;

          return {
            thread: { ...thread, bot },
            shown: !(bot && repo.notifications.bar.ignoreBotActivity),
          };
        });

      const managedRepoForNotification = (notificationRepo: string) =>
        Effect.gen(function* () {
          const exact = managedGitRepoForGitHub(
            config.gitConfig,
            notificationRepo,
          );

          if (exact) return exact;

          const normalizedNotificationRepo = notificationRepo.toLowerCase();

          for (const repo of managedGitRepos(config.gitConfig)) {
            const slugs = yield* managedRepoGitHubSlugs(repo, executor);

            if (
              slugs.some(
                (slug) => slug.toLowerCase() === normalizedNotificationRepo,
              )
            ) {
              return repo;
            }
          }

          return undefined;
        });

      const runAction = Effect.fn("GitNotifications.runAction")(function* (
        action: GitNotificationAction,
        threadId: string,
        method: "PATCH" | "DELETE",
      ): Effect.fn.Return<GitNotificationActionResult, GitNotificationError> {
        const endpoint = threadEndpoint(threadId);

        yield* github.write(endpoint, Api.empty({ endpoint, method })).pipe(
          Effect.mapError(
            (error) =>
              new GitNotificationError({
                message: formatGhError(error),
                threadId,
                action,
              }),
          ),
        );

        return {
          action,
          threadId,
          message: actionMessage(action, threadId),
        };
      });

      const markRead = (threadId: string) =>
        runAction("read", threadId, "PATCH");

      const markDone = (threadId: string) =>
        runAction("done", threadId, "DELETE");

      const review = Effect.fn("GitNotifications.review")(
        function* (repos?: readonly string[]) {
          const pages = yield* Effect.forEach(
            repos ?? [undefined],
            (repo) => fetchThreads({ repo }),
            { concurrency: 2 },
          );

          const seen = new Set<string>();

          const threads = pages.flat().filter((thread) => {
            if (!thread.unread || seen.has(thread.id)) return false;
            seen.add(thread.id);

            return true;
          });

          return yield* Effect.forEach(
            threads,
            (thread) => inspectNotification(thread, github),
            { concurrency: 4 },
          );
        },
        Effect.mapError(
          (error) =>
            new GitNotificationError({ message: formatGhError(error) }),
        ),
      );

      const dismiss = Effect.fn("GitNotifications.dismiss")(function* (
        entries: readonly GitNotificationReview[],
        category: GitNotificationCategory,
      ) {
        return yield* Effect.forEach(
          entries,
          (entry) =>
            Effect.gen(function* (): Effect.fn.Return<
              GitNotificationDismissal,
              GitNotificationError
            > {
              if (entry.category !== category)
                return {
                  entry,
                  status: "skipped",
                  message: "Notification belongs to a different review pass",
                };

              const endpoint = threadEndpoint(entry.thread.id);

              const current = yield* github
                .read(
                  endpoint,
                  Api.json({ endpoint, method: "GET" }, NotificationRecord),
                )
                .pipe(
                  Effect.map(toNotificationThread),
                  Effect.mapError(
                    (error) =>
                      new GitNotificationError({
                        message: formatGhError(error),
                      }),
                  ),
                );

              if (
                !current.unread ||
                current.updatedAt !== entry.thread.updatedAt ||
                current.subjectApiUrl !== entry.thread.subjectApiUrl ||
                current.repo !== entry.thread.repo
              )
                return {
                  entry,
                  status: "skipped",
                  message:
                    "Notification changed or is already read; review it again",
                };
              const inspected = yield* inspectNotification(current, github);

              if (
                inspected.category !== entry.category ||
                inspected.detail !== entry.detail ||
                inspected.headSha !== entry.headSha ||
                (category === "dependencies" && inspected.inspectionFailed)
              )
                return {
                  entry,
                  status: "skipped",
                  message: `Evidence changed; review again: ${inspected.detail}`,
                };
              yield* markDone(current.id);

              return { entry, status: "done", message: "Marked done" };
            }).pipe(
              Effect.catch((error) =>
                Effect.succeed<GitNotificationDismissal>({
                  entry,
                  status: "failed",
                  message: error.message,
                }),
              ),
            ),
          { concurrency: 2 },
        );
      });

      return {
        review,
        dismiss,
        query,
        markRead,
      };
    }),
  );
}

function notificationEndpoint(opts?: GitNotificationQueryOptions): string {
  const params = new URLSearchParams();
  params.set("per_page", String(NOTIFICATION_LIMIT));

  if (opts?.all) params.set("all", "true");

  if (opts?.participating) params.set("participating", "true");

  return `${opts?.repo ? `repos/${opts.repo}/` : ""}notifications?${params.toString()}`;
}

function threadEndpoint(threadId: string): string {
  return `notifications/threads/${encodeURIComponent(threadId)}`;
}

function normalizeQuery(
  opts?: GitNotificationQueryOptions,
): GitNotificationQueryOptions {
  return {
    ...(opts?.repo && { repo: opts.repo }),
    ...(opts?.all && { all: true }),
    ...(opts?.participating && { participating: true }),
    ...(opts?.barFilter && { barFilter: true }),
  };
}

function notificationThreadLooksBot(
  thread: GitNotificationThread,
  github: GitHubService,
) {
  if (notificationReasonIsImportant(thread.reason)) {
    return Effect.succeed(false);
  }

  switch (thread.type) {
    case "PullRequest":
      return pullRequestThreadLooksBot(thread, github);
    case "WorkflowRun":
    case "CheckSuite":
      if (valuesLookLikeBotActivity([thread.title, thread.webUrl])) {
        return Effect.succeed(true);
      }

      return workflowNotificationThreadLooksBot(thread, github);
    default:
      return Effect.succeed(
        valuesLookLikeBotActivity([thread.title, thread.webUrl]),
      );
  }
}

function pullRequestThreadLooksBot(
  thread: GitNotificationThread,
  github: GitHubService,
) {
  const threadLooksBot = valuesLookLikeBotActivity([
    thread.title,
    thread.webUrl,
  ]);

  const endpoint = apiEndpointFromUrl(thread.subjectApiUrl);

  if (!endpoint) return Effect.succeed(threadLooksBot);

  return github
    .read(endpoint, Api.json({ endpoint, method: "GET" }, PullRequestActivity))
    .pipe(
      Effect.map((pull) => {
        if (pull.draft === true) return false;

        return (
          threadLooksBot ||
          valuesLookLikeBotActivity([
            pull.user?.login ?? "",
            pull.head?.ref ?? "",
          ])
        );
      }),
      Effect.orElseSucceed(() => threadLooksBot),
    );
}

function workflowNotificationThreadLooksBot(
  thread: GitNotificationThread,
  github: GitHubService,
) {
  const endpoint = apiEndpointFromUrl(thread.subjectApiUrl);

  if (!endpoint) return Effect.succeed(false);

  return github
    .read(endpoint, Api.json({ endpoint, method: "GET" }, WorkflowRunActivity))
    .pipe(
      Effect.map((run) =>
        valuesLookLikeBotActivity([
          run.actor?.login ?? "",
          run.head_branch ?? null,
          run.head_commit?.author?.name ?? "",
          run.head_commit?.author?.email ?? "",
        ]),
      ),
      Effect.orElseSucceed(() => false),
    );
}

const Login = Schema.NullOr(Schema.Struct({ login: Schema.String }));

/** Fields of a pull request that mark bot activity. */
const PullRequestActivity = Schema.Struct({
  draft: Schema.optionalKey(Schema.Boolean),
  user: Schema.optionalKey(Login),
  head: Schema.optionalKey(Schema.Struct({ ref: Schema.String })),
});

/** Fields of a workflow run that mark bot activity. */
const WorkflowRunActivity = Schema.Struct({
  actor: Schema.optionalKey(Login),
  head_branch: Schema.optionalKey(Schema.NullOr(Schema.String)),
  head_commit: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        author: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              name: Schema.optionalKey(Schema.String),
              email: Schema.optionalKey(Schema.String),
            }),
          ),
        ),
      }),
    ),
  ),
});

function apiEndpointFromUrl(url: string | null): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    if (parsed.hostname !== "api.github.com") return null;

    return parsed.pathname.replace(/^\//, "");
  } catch {
    return null;
  }
}

function buildState(
  threads: readonly GitNotificationThread[],
  totalCount: number,
  lastChecked: Date,
  query: GitNotificationQueryOptions,
  message?: string,
  inbox: readonly GitNotificationThread[] = threads,
): GitNotificationState {
  return {
    inbox,
    threads,
    totalCount,
    lastChecked,
    query,
    ...(message && { message }),
  };
}

function toNotificationThread(
  record: GhNotificationRecord,
): GitNotificationThread {
  const repo = recordValue(record.repository);
  const subject = recordValue(record.subject);
  const repoSlug = stringValue(repo.full_name) || "unknown/repository";

  const repoUrl =
    stringValue(repo.html_url) || `https://github.com/${repoSlug}`;

  const subjectApiUrl = nullableStringValue(subject.url);
  const webUrl = subjectWebUrl(subjectApiUrl, repoUrl);

  return {
    id: stringValue(record.id),
    repo: repoSlug,
    repoUrl,
    title: stringValue(subject.title) || "Untitled notification",
    type: normalizeSubjectType(stringValue(subject.type)),
    reason: stringValue(record.reason) || "unknown",
    unread: record.unread === true,
    updatedAt: nullableStringValue(record.updated_at),
    lastReadAt: nullableStringValue(record.last_read_at),
    webUrl,
    apiUrl: stringValue(record.url),
    subjectApiUrl,
    latestCommentApiUrl: nullableStringValue(subject.latest_comment_url),
  };
}

function subjectWebUrl(subjectApiUrl: string | null, repoUrl: string): string {
  if (!subjectApiUrl) return repoUrl;

  const path = parseSubjectApiPath(subjectApiUrl);

  return path ? subjectPathWebUrl(path) || repoUrl : repoUrl;
}

function normalizeSubjectType(value: string): GitNotificationSubjectType {
  if (
    value === "Issue" ||
    value === "PullRequest" ||
    value === "Release" ||
    value === "Discussion" ||
    value === "Commit" ||
    value === "WorkflowRun" ||
    value === "CheckSuite" ||
    value === "RepositoryAdvisory" ||
    value === "SecurityAdvisory"
  )
    return value;

  return "unknown";
}

function parseSubjectApiPath(
  subjectApiUrl: string,
): { readonly base: string; readonly tail: readonly string[] } | null {
  try {
    const url = new URL(subjectApiUrl);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] !== "repos" || parts.length < 4) return null;

    return {
      base: `https://github.com/${parts[1]}/${parts[2]}`,
      tail: parts.slice(3),
    };
  } catch {
    return null;
  }
}

function subjectPathWebUrl(path: {
  readonly base: string;
  readonly tail: readonly string[];
}): string | null {
  const [kind, detail, id] = path.tail;

  switch (kind) {
    case "issues":
      return detail ? `${path.base}/issues/${detail}` : null;
    case "pulls":
      return detail ? `${path.base}/pull/${detail}` : null;
    case "commits":
      return detail ? `${path.base}/commit/${detail}` : null;
    case "git":
      return detail === "commits" && id ? `${path.base}/commit/${id}` : null;
    case "actions":
      return detail === "runs" && id ? `${path.base}/actions/runs/${id}` : null;
    case "discussions":
      return detail ? `${path.base}/discussions/${detail}` : null;
    default:
      return null;
  }
}

function recordValue(value: JsonValue): JsonObject {
  return isRecord(value) ? value : {};
}

function isRecord(value: JsonValue): value is GhNotificationRecord {
  return Schema.is(Schema.Record(Schema.String, Schema.Json))(value);
}

function actionMessage(
  action: GitNotificationAction,
  threadId: string,
): string {
  switch (action) {
    case "read":
      return `Marked read: ${threadId}`;
    case "done":
      return `Marked done: ${threadId}`;
  }
}
