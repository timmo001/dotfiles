import { Effect } from "effect";
import type {
  GitNotificationAction,
  GitNotificationBotReadResult,
  GitNotificationQueryOptions,
  GitNotificationState,
  GitNotificationThread,
} from "../../types.js";
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
import {
  formatCommandError,
  handleCommandError,
  pipeRow,
  writeJsonLine,
  writeRows,
  writeText,
} from "./rows.js";

const handleNotificationError = handleCommandError("dot git-notifications");

/** CLI text output: --raw notification summary. */
export const notificationsRaw = (opts?: GitNotificationQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshNotificationState(opts);
    yield* writeText(formatRaw(state));
  }).pipe(Effect.withSpan("notifications.raw"), handleNotificationError);

/** Machine output: status bar JSON. */
export const notificationsBarJson = (opts?: GitNotificationQueryOptions) =>
  Effect.gen(function* () {
    const filteredState = yield* refreshNotificationState({
      ...opts,
      barFilter: true,
    });
    yield* writeJsonLine(formatBarJson(filteredState));
  }).pipe(Effect.withSpan("notifications.barJson"), handleNotificationError);

/** Machine output: --list-threads pipe-delimited notification rows. */
export const notificationsListThreads = (opts?: GitNotificationQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshNotificationState(opts);
    yield* writeRows(state.threads.map(formatThreadRow));
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
    yield* writeText(`${result.message}\n`);
  }).pipe(Effect.withSpan("notifications.action"), handleNotificationError);

/** Mark unread bot notification threads as read, or preview them with --dry-run. */
export const notificationsMarkBotRead = (
  opts?: GitNotificationQueryOptions,
  actionOpts?: { readonly dryRun?: boolean },
) =>
  Effect.gen(function* () {
    const notifications = yield* GitNotifications;
    const result = yield* notifications.markBotRead(opts, actionOpts);
    yield* writeText(formatBotReadResult(result));
  }).pipe(
    Effect.withSpan("notifications.markBotRead"),
    handleNotificationError,
  );

function refreshNotificationState(opts?: GitNotificationQueryOptions) {
  return Effect.gen(function* () {
    const notifications = yield* GitNotifications;
    yield* notifications.refresh(opts);
    return yield* notifications.getState();
  });
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
  // Always emit the count (including "0") so the bar widget has an icon to
  // reveal dimmed on hover; the "hidden" class still collapses it when clear.
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

function formatBotReadResult(result: GitNotificationBotReadResult): string {
  const action = result.dryRun ? "Would mark" : "Marked";
  const lines = [
    `${action} ${result.dryRun ? result.matched.length : result.marked.length} bot notification${pluralSuffix(result.dryRun ? result.matched.length : result.marked.length)} read.`,
  ];

  if (!result.dryRun && result.failed.length > 0) {
    lines.push(
      `Failed: ${result.failed.length} notification${pluralSuffix(result.failed.length)}.`,
    );
  }

  const threads = result.dryRun ? result.matched : result.marked;
  if (threads.length > 0) {
    lines.push("", "Matched threads:");
    for (const thread of threads) {
      lines.push(`  ${formatBotReadThread(thread)}`);
    }
  }

  if (result.failed.length > 0) {
    lines.push("", "Failures:");
    for (const failure of result.failed) {
      lines.push(
        `  ${formatBotReadThread(failure.thread)}: ${failure.message}`,
      );
    }
  }

  return lines.join("\n") + "\n";
}

function formatBotReadThread(thread: GitNotificationThread): string {
  return `${thread.id} | ${thread.repo} | ${thread.type} | ${thread.title}`;
}

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

function appendNotificationQueryLines(
  lines: string[],
  query: GitNotificationQueryOptions,
): void {
  if (query.all) lines.push("Including read notifications");
  if (query.participating) lines.push("Participating only");
  if (query.since) lines.push(`Since: ${query.since}`);
  if (query.barFilter) lines.push("Status-bar filters active");
}

function formatError(error: unknown): string {
  if (error instanceof GitNotificationError) return error.message;
  return formatCommandError(error);
}
