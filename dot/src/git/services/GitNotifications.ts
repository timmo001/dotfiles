import { Clock, Context, Effect, Layer, PubSub, Schema, Stream } from "effect";
import type {
  GitNotificationAction,
  GitNotificationActionResult,
  GitNotificationBotReadOptions,
  GitNotificationBotReadResult,
  GitNotificationQueryOptions,
  GitNotificationState,
  GitNotificationSubjectType,
  GitNotificationThread,
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
import { managedRepoGitHubSlugs } from "./repoRelations.js";
import { formatGhError, nullableStringValue, stringValue } from "./record.js";
import { ENV, envString } from "../../lib/env.js";
import type { JsonObject, JsonValue } from "../../lib/schema.js";

const NOTIFICATION_LIMIT = 50;
const DEBUG = !!envString(ENV.DOT_DEBUG);
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:GitNotifications] ${msg}`);
};

/** Domain error for GitHub notification operations. */
export class GitNotificationError extends Schema.TaggedErrorClass<GitNotificationError>()(
  "GitNotificationError",
  {
    message: Schema.String,
    threadId: Schema.optional(Schema.String),
    action: Schema.optional(Schema.String),
  },
) {}

/** Service interface for the authenticated user's GitHub notification inbox. */
interface GitNotificationsService {
  /** Subscribe to notification inbox state snapshots. */
  readonly subscribe: () => Stream.Stream<GitNotificationState>;
  /** Refresh notification threads from GitHub. */
  readonly refresh: (opts?: GitNotificationQueryOptions) => Effect.Effect<void>;
  /** Return the most recent notification state. */
  readonly getState: () => Effect.Effect<GitNotificationState>;
  /** Mark a notification thread as read. */
  readonly markRead: (
    threadId: string,
  ) => Effect.Effect<GitNotificationActionResult, GitNotificationError>;
  /** Mark unread bot notification threads as read, or preview them in dry-run mode. */
  readonly markBotRead: (
    opts?: GitNotificationQueryOptions,
    actionOpts?: GitNotificationBotReadOptions,
  ) => Effect.Effect<GitNotificationBotReadResult, GitNotificationError>;
  /** Mark a notification thread as done. */
  readonly markDone: (
    threadId: string,
  ) => Effect.Effect<GitNotificationActionResult, GitNotificationError>;
  /** Ignore new notifications for a thread. */
  readonly ignore: (
    threadId: string,
  ) => Effect.Effect<GitNotificationActionResult, GitNotificationError>;
  /** Stop ignoring notifications for a thread. */
  readonly unignore: (
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
      const pubsub = yield* PubSub.unbounded<GitNotificationState>();
      const hiddenThreadIds = new Set<string>();

      let currentState = buildState(
        [],
        new Date(yield* Clock.currentTimeMillis),
        false,
        false,
        {},
        hiddenThreadIds,
      );

      const fetchNotificationPage = Effect.fn(
        "GitNotifications.fetchNotificationPage",
      )(function* (opts?: GitNotificationQueryOptions) {
        const parsed = yield* github.json(notificationListArgs(opts));
        return Array.isArray(parsed)
          ? parsed.filter(isNotificationRecord).map(toNotificationThread)
          : [];
      });

      const fetchThreads = Effect.fn("GitNotifications.fetchThreads")(
        function* (opts?: GitNotificationQueryOptions) {
          return yield* fetchNotificationPage(normalizeQuery(opts));
        },
      );

      const refresh = (opts?: GitNotificationQueryOptions) =>
        Effect.gen(function* () {
          const query = normalizeQuery(opts);
          currentState = buildState(
            currentState.threads,
            new Date(yield* Clock.currentTimeMillis),
            true,
            currentState.loaded,
            query,
            hiddenThreadIds,
          );
          yield* PubSub.publish(pubsub, currentState);

          const hasGh = yield* github.isAvailable();
          if (!hasGh) {
            currentState = buildState(
              [],
              new Date(yield* Clock.currentTimeMillis),
              false,
              true,
              query,
              hiddenThreadIds,
              "gh CLI not found",
            );
            yield* PubSub.publish(pubsub, currentState);
            return;
          }

          const visibleThreads = filterHiddenThreads(
            yield* fetchThreads(query),
            hiddenThreadIds,
          );
          const threads = yield* filterBarThreadsIfNeeded(
            visibleThreads,
            query,
          );
          currentState = buildState(
            threads,
            new Date(yield* Clock.currentTimeMillis),
            false,
            true,
            query,
            hiddenThreadIds,
          );
          yield* PubSub.publish(pubsub, currentState);
          log(`Refresh complete: ${threads.length} notification threads`);
        }).pipe(
          Effect.withSpan("GitNotifications.refresh"),
          Effect.catch((error) =>
            Effect.gen(function* () {
              const query = normalizeQuery(opts);
              currentState = buildState(
                currentState.threads,
                new Date(yield* Clock.currentTimeMillis),
                false,
                currentState.loaded,
                query,
                hiddenThreadIds,
                formatGhError(error),
              );
              yield* PubSub.publish(pubsub, currentState);
            }),
          ),
        );

      const filterBarThreadsIfNeeded = (
        threads: readonly GitNotificationThread[],
        query: GitNotificationQueryOptions,
      ) => {
        if (!query.barFilter) {
          return Effect.succeed(threads);
        }
        if (!config.canUsePrivate || !config.gitConfig.valid)
          return Effect.succeed([]);

        return Effect.all(
          threads.map((thread) => includeBarThread(thread)),
          { concurrency: 4 },
        ).pipe(
          Effect.map((filtered) =>
            filtered.filter(
              (thread): thread is GitNotificationThread => thread !== null,
            ),
          ),
        );
      };

      const includeBarThread = (thread: GitNotificationThread) =>
        Effect.gen(function* () {
          const repo = yield* managedRepoForNotification(thread.repo);
          if (!repo) return null;
          if (!gitRepoNotificationsActive(repo)) return null;
          if (!repo.notifications.bar.ignoreBotActivity) return thread;
          const botThread = yield* notificationThreadLooksBot(thread, github);
          return botThread ? null : thread;
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
        args: readonly string[],
      ): Effect.fn.Return<GitNotificationActionResult, GitNotificationError> {
        yield* github.run(args).pipe(
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
        runAction("read", threadId, [
          "api",
          "-X",
          "PATCH",
          threadEndpoint(threadId),
        ]);

      const markBotRead = (
        opts?: GitNotificationQueryOptions,
        actionOpts?: GitNotificationBotReadOptions,
      ) =>
        Effect.gen(function* () {
          const query = normalizeQuery(opts);
          const threads = yield* fetchThreads(query);
          const unreadThreads = threads.filter((thread) => thread.unread);
          const botChecks = yield* Effect.all(
            unreadThreads.map((thread) =>
              notificationThreadLooksBot(thread, github).pipe(
                Effect.map((bot) => ({ thread, bot })),
              ),
            ),
            { concurrency: 4 },
          );
          const matched = botChecks
            .filter((check) => check.bot)
            .map((check) => check.thread);
          const dryRun = actionOpts?.dryRun === true;

          if (dryRun) {
            return {
              dryRun,
              matched,
              marked: [],
              failed: [],
            } satisfies GitNotificationBotReadResult;
          }

          const results = yield* Effect.all(
            matched.map((thread) =>
              markRead(thread.id).pipe(
                Effect.matchEffect({
                  onSuccess: () =>
                    Effect.succeed({ type: "marked" as const, thread }),
                  onFailure: (error) =>
                    Effect.succeed({
                      type: "failed" as const,
                      thread,
                      message: error.message,
                    }),
                }),
              ),
            ),
            { concurrency: 4 },
          );
          const marked = results
            .filter((result) => result.type === "marked")
            .map((result) => result.thread);
          const failed = results
            .filter((result) => result.type === "failed")
            .map((result) => ({
              thread: result.thread,
              message: result.message,
            }));

          return { dryRun, matched, marked, failed };
        }).pipe(
          Effect.withSpan("GitNotifications.markBotRead"),
          Effect.mapError((error) =>
            error instanceof GitNotificationError
              ? error
              : new GitNotificationError({
                  message: formatGhError(error),
                  action: "mark-bot-read",
                }),
          ),
        );

      const markDone = (threadId: string) =>
        Effect.gen(function* () {
          const result = yield* runAction("done", threadId, [
            "api",
            "-X",
            "DELETE",
            threadEndpoint(threadId),
          ]);
          hiddenThreadIds.add(threadId);
          currentState = buildState(
            filterHiddenThreads(currentState.threads, hiddenThreadIds),
            new Date(yield* Clock.currentTimeMillis),
            false,
            currentState.loaded,
            currentState.query,
            hiddenThreadIds,
            result.message,
          );
          yield* PubSub.publish(pubsub, currentState);
          return result;
        });

      const ignore = (threadId: string) =>
        runAction("ignore", threadId, subscriptionArgs(threadId, true));

      const unignore = (threadId: string) =>
        runAction("unignore", threadId, subscriptionArgs(threadId, false));

      return {
        subscribe: () => Stream.fromPubSub(pubsub),
        refresh,
        getState: () => Effect.succeed(currentState),
        markRead,
        markBotRead,
        markDone,
        ignore,
        unignore,
      };
    }),
  );
}

function notificationListArgs(
  opts?: GitNotificationQueryOptions,
): readonly string[] {
  return ["api", notificationEndpoint(opts)];
}

function notificationEndpoint(opts?: GitNotificationQueryOptions): string {
  const params = new URLSearchParams();
  params.set("per_page", String(NOTIFICATION_LIMIT));
  if (opts?.all) params.set("all", "true");
  if (opts?.participating) params.set("participating", "true");
  if (opts?.since) params.set("since", opts.since);
  return `notifications?${params.toString()}`;
}

function threadEndpoint(threadId: string): string {
  return `notifications/threads/${encodeURIComponent(threadId)}`;
}

function subscriptionArgs(
  threadId: string,
  ignored: boolean,
): readonly string[] {
  return [
    "api",
    "-X",
    "PUT",
    `${threadEndpoint(threadId)}/subscription`,
    "-F",
    `ignored=${ignored ? "true" : "false"}`,
  ];
}

function normalizeQuery(
  opts?: GitNotificationQueryOptions,
): GitNotificationQueryOptions {
  return {
    ...(opts?.all && { all: true }),
    ...(opts?.participating && { participating: true }),
    ...(opts?.since && { since: opts.since }),
    ...(opts?.barFilter && { barFilter: true }),
  };
}

function notificationThreadLooksBot(
  thread: GitNotificationThread,
  github: GitHubService,
) {
  if (valuesLookLikeBotActivity([thread.title, thread.webUrl])) {
    return Effect.succeed(true);
  }

  switch (thread.type) {
    case "PullRequest":
      return pullRequestThreadLooksBot(thread, github);
    case "WorkflowRun":
    case "CheckSuite":
      return workflowNotificationThreadLooksBot(thread, github);
    default:
      return Effect.succeed(false);
  }
}

function pullRequestThreadLooksBot(
  thread: GitNotificationThread,
  github: GitHubService,
) {
  const endpoint = apiEndpointFromUrl(thread.subjectApiUrl);
  if (!endpoint) return Effect.succeed(false);
  return github.json(["api", endpoint]).pipe(
    Effect.map((value) => {
      const decoded = Schema.decodeUnknownOption(
        Schema.Record(Schema.String, Schema.Json),
      )(value);
      if (decoded._tag === "None") return false;
      const user = recordValue(decoded.value.user);
      const head = recordValue(decoded.value.head);
      return valuesLookLikeBotActivity([
        stringValue(user.login),
        stringValue(head.ref),
      ]);
    }),
    Effect.catch(() => Effect.succeed(false)),
  );
}

function workflowNotificationThreadLooksBot(
  thread: GitNotificationThread,
  github: GitHubService,
) {
  const endpoint = apiEndpointFromUrl(thread.subjectApiUrl);
  if (!endpoint) return Effect.succeed(false);
  return github.json(["api", endpoint]).pipe(
    Effect.map((value) => {
      const decoded = Schema.decodeUnknownOption(
        Schema.Record(Schema.String, Schema.Json),
      )(value);
      if (decoded._tag === "None") return false;
      const actor = recordValue(decoded.value.actor);
      const headCommit = recordValue(decoded.value.head_commit);
      const author = recordValue(headCommit.author);
      return valuesLookLikeBotActivity([
        stringValue(actor.login),
        nullableStringValue(decoded.value.head_branch),
        stringValue(author.name),
        stringValue(author.email),
      ]);
    }),
    Effect.catch(() => Effect.succeed(false)),
  );
}

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

function notificationThreadKey(thread: GitNotificationThread): string {
  return thread.id || thread.webUrl;
}

function filterHiddenThreads(
  threads: readonly GitNotificationThread[],
  hiddenThreadIds: ReadonlySet<string>,
): readonly GitNotificationThread[] {
  if (hiddenThreadIds.size === 0) return threads;
  return threads.filter(
    (thread) => !hiddenThreadIds.has(notificationThreadKey(thread)),
  );
}

function buildState(
  threads: readonly GitNotificationThread[],
  lastChecked: Date,
  loading: boolean,
  loaded: boolean,
  query: GitNotificationQueryOptions,
  hiddenThreadIds: ReadonlySet<string>,
  message?: string,
): GitNotificationState {
  return {
    threads,
    hiddenThreadIds: [...hiddenThreadIds],
    lastChecked,
    loading,
    loaded,
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
    value === "Commit"
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

function isNotificationRecord(value: JsonValue): value is GhNotificationRecord {
  return isRecord(value);
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
    case "ignore":
      return `Ignored: ${threadId}`;
    case "unignore":
      return `Unignored: ${threadId}`;
  }
}
