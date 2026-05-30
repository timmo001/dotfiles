import { Effect } from "effect";
import type {
  GitNotificationAction,
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

/** Machine output: --waybar JSON. */
export const notificationsWaybar = (opts?: GitNotificationQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshNotificationState(opts);
    yield* Effect.sync(() =>
      process.stdout.write(JSON.stringify(formatWaybar(state)) + "\n"),
    );
  }).pipe(Effect.withSpan("notifications.waybar"), handleNotificationError);

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

function formatWaybar(state: GitNotificationState): {
  readonly text: string;
  readonly tooltip: string;
  readonly class: string;
} {
  const summary = notificationStateSummary(state);
  const text = state.message
    ? "\uf071 ?"
    : summary.unreadCount > 0
      ? `\uf0f3 ${summary.unreadCount}`
      : "";
  const cls = state.message
    ? "notifications-unknown"
    : summary.unreadCount > 0
      ? summary.importantUnreadCount > 0
        ? "notifications-attention"
        : "notifications-unread"
      : "hidden";

  return {
    text,
    tooltip: formatWaybarTooltip(state, summary),
    class: cls,
  };
}

function formatWaybarTooltip(
  state: GitNotificationState,
  summary: ReturnType<typeof notificationStateSummary>,
): string {
  if (state.message) return `GitHub notifications: ${state.message}`;
  if (state.threads.length === 0) return "GitHub notifications: inbox clear.";

  const lines = [
    `GitHub notifications: ${summary.unreadCount} unread, ${summary.importantUnreadCount} important, ${state.threads.length} shown.`,
  ];
  appendNotificationQueryLines(lines, state.query);
  for (const thread of state.threads.slice(0, 10)) {
    lines.push(`${thread.repo}: ${thread.title} (${thread.reason})`);
  }
  if (state.threads.length > 10) {
    lines.push(`+${state.threads.length - 10} more`);
  }
  return lines.join("\n");
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
