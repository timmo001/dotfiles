import { Effect } from "effect";
import type {
  GitNotificationAction,
  GitNotificationQueryOptions,
  GitNotificationState,
  GitNotificationThread,
} from "../../types.js";
import { Config } from "../../services/Config.js";
import {
  gitRepoNotificationsActive,
  managedGitRepoForGitHub,
} from "../../services/GitConfig.js";
import { GitHub, type GitHubService } from "../services/GitHub.js";
import { valuesLookLikeBotActivity } from "../services/botActivity.js";
import { nullableStringValue, stringValue } from "../services/record.js";
import {
  GitNotificationError,
  GitNotifications,
} from "../services/GitNotifications.js";
import {
  formatNotificationIcon,
  formatNotificationThreadDetail,
  formatNotificationTimeAgo,
  notificationReasonIsImportant,
} from "../services/notificationStatus.js";
import { pipeRow } from "./rows.js";

const handleNotificationError = Effect.catch((error: unknown) =>
  Effect.sync(() => {
    console.error(`[dot git-notifications] ${formatError(error)}`);
    process.exit(1);
  }),
);

/** CLI text output: --raw notification summary. */
export const notificationsRaw = (opts?: GitNotificationQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshNotificationState(opts);
    yield* Effect.sync(() => process.stdout.write(formatRaw(state)));
  }).pipe(Effect.withSpan("notifications.raw"), handleNotificationError);

/** Machine output: status bar JSON. */
export const notificationsBarJson = (opts?: GitNotificationQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshNotificationState(opts);
    const filteredState = yield* filterNotificationBarState(state);
    yield* Effect.sync(() =>
      process.stdout.write(JSON.stringify(formatBarJson(filteredState)) + "\n"),
    );
  }).pipe(Effect.withSpan("notifications.barJson"), handleNotificationError);

/** Machine output: --list-threads pipe-delimited notification rows. */
export const notificationsListThreads = (opts?: GitNotificationQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshNotificationState(opts);
    yield* Effect.sync(() => {
      for (const thread of state.threads) {
        process.stdout.write(formatThreadRow(thread) + "\n");
      }
    });
  }).pipe(
    Effect.withSpan("notifications.listThreads"),
    handleNotificationError,
  );

/** Apply a mutating notification action and print the result. */
export const notificationsAction = (
  action: GitNotificationAction,
  threadId: string,
) =>
  Effect.gen(function* () {
    const notifications = yield* GitNotifications;
    const actionEffects = {
      read: notifications.markRead,
      done: notifications.markDone,
      ignore: notifications.ignore,
      unignore: notifications.unignore,
    };
    const result = yield* actionEffects[action](threadId);
    yield* Effect.sync(() => process.stdout.write(`${result.message}\n`));
  }).pipe(Effect.withSpan("notifications.action"), handleNotificationError);

function refreshNotificationState(opts?: GitNotificationQueryOptions) {
  return Effect.gen(function* () {
    const notifications = yield* GitNotifications;
    yield* notifications.refresh(opts);
    return yield* notifications.getState();
  });
}

function filterNotificationBarState(state: GitNotificationState) {
  return Effect.gen(function* () {
    const config = yield* Config;
    if (!config.canUsePrivate || !config.gitConfig.valid) return state;

    const github = yield* GitHub;
    const filtered = yield* Effect.all(
      state.threads.map((thread) =>
        includeNotificationBarThread(thread, github),
      ),
      { concurrency: 4 },
    );

    return {
      ...state,
      threads: filtered.filter(
        (thread): thread is GitNotificationThread => thread !== null,
      ),
    } satisfies GitNotificationState;

    function includeNotificationBarThread(
      thread: GitNotificationThread,
      github: GitHubService,
    ) {
      return Effect.gen(function* () {
        const repo = managedGitRepoForGitHub(config.gitConfig, thread.repo);
        if (!repo) return thread;
        if (!gitRepoNotificationsActive(repo)) return null;
        if (!repo.notifications.bar.ignoreBotActivity) return thread;
        const botThread = yield* notificationThreadLooksBot(thread, github);
        return botThread ? null : thread;
      });
    }
  });
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
      if (!isRecord(value)) return false;
      const user = recordValue(value.user);
      const head = recordValue(value.head);
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
      if (!isRecord(value)) return false;
      const actor = recordValue(value.actor);
      const headCommit = recordValue(value.head_commit);
      const author = recordValue(headCommit.author);
      return valuesLookLikeBotActivity([
        stringValue(actor.login),
        nullableStringValue(value.head_branch),
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

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatRaw(state: GitNotificationState): string {
  const summary = notificationStateSummary(state);
  const lines = [
    "GitHub Notifications",
    `Last checked: ${formatNotificationTimeAgo(state.lastChecked.toISOString())}`,
    `Unread: ${summary.unreadCount} / ${state.threads.length}`,
  ];

  appendNotificationQueryLines(lines, state.query);
  if (state.message) lines.push(`Message: ${state.message}`);
  if (state.threads.length === 0) {
    lines.push("", "No GitHub notifications.");
    return lines.join("\n") + "\n";
  }

  for (const thread of state.threads) {
    lines.push("", `${formatNotificationIcon(thread)} ${thread.repo}`);
    lines.push(`  ${formatNotificationThreadDetail(thread)}`);
    lines.push(`  ${thread.title}`);
    lines.push(`  ${thread.webUrl}`);
  }

  return lines.join("\n") + "\n";
}

function formatBarJson(state: GitNotificationState): {
  readonly text: string;
  readonly tooltip: string;
  readonly class: string;
} {
  const summary = notificationStateSummary(state);

  return {
    text: notificationBarText(state, summary),
    tooltip: formatBarJsonTooltip(state, summary),
    class: notificationBarClass(state, summary),
  };
}

function notificationBarText(
  state: GitNotificationState,
  summary: ReturnType<typeof notificationStateSummary>,
): string {
  if (state.message) return "\uf071 ?";
  if (summary.unreadCount === 0) return "";
  return `\uf0f3 ${summary.unreadCount}`;
}

function notificationBarClass(
  state: GitNotificationState,
  summary: ReturnType<typeof notificationStateSummary>,
): string {
  if (state.message) return "notifications-unknown";
  if (summary.unreadCount === 0) return "hidden";
  if (summary.importantUnreadCount > 0) return "notifications-attention";
  return "notifications-unread";
}

function formatBarJsonTooltip(
  state: GitNotificationState,
  summary: ReturnType<typeof notificationStateSummary>,
): string {
  if (state.message) return `GitHub notifications: ${state.message}`;
  if (state.threads.length === 0) return "GitHub notifications: inbox clear.";

  const lines = [
    `GitHub notifications: ${summary.unreadCount} unread, ${summary.importantUnreadCount} important, ${state.threads.length} shown.`,
  ];
  appendNotificationQueryLines(lines, state.query);
  appendNotificationThreadLines(lines, state.threads);
  return lines.join("\n");
}

function appendNotificationThreadLines(
  lines: string[],
  threads: readonly GitNotificationThread[],
): void {
  for (const thread of threads.slice(0, 10)) {
    lines.push(`${thread.repo}: ${thread.title} (${thread.reason})`);
  }
  if (threads.length > 10) lines.push(`+${threads.length - 10} more`);
}

function notificationStateSummary(state: GitNotificationState): {
  readonly unreadCount: number;
  readonly importantUnreadCount: number;
} {
  let unreadCount = 0;
  let importantUnreadCount = 0;

  for (const thread of state.threads) {
    if (!thread.unread) continue;
    unreadCount += 1;
    if (notificationReasonIsImportant(thread.reason)) importantUnreadCount += 1;
  }

  return { unreadCount, importantUnreadCount };
}

function formatThreadRow(thread: GitNotificationThread): string {
  return pipeRow([
    thread.id,
    thread.repo,
    thread.reason,
    thread.type,
    thread.unread ? "unread" : "read",
    thread.updatedAt,
    thread.title,
    thread.webUrl,
  ]);
}

function appendNotificationQueryLines(
  lines: string[],
  query: GitNotificationQueryOptions,
): void {
  if (query.all) lines.push("Including read notifications");
  if (query.participating) lines.push("Participating only");
  if (query.since) lines.push(`Since: ${query.since}`);
}

function formatError(error: unknown): string {
  if (error instanceof GitNotificationError) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return String(error);
}
