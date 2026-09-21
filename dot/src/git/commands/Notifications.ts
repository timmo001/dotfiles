import { Effect } from "effect";
import type {
  GitNotificationQueryOptions,
  GitNotificationState,
  GitNotificationThread,
} from "../../types.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import { managedGitRepos } from "../../services/GitConfig.js";
import { managedRepoGitHubSlugs } from "../services/repoRelations.js";
import { GitNotifications } from "../services/GitNotifications.js";
import {
  formatNotificationIcon,
  formatNotificationThreadDetail,
  formatNotificationTimeAgo,
  notificationReasonIsImportant,
} from "../services/notificationStatus.js";
import { handleCommandError, writeJsonLine, writeText } from "./rows.js";

const handleNotificationError = handleCommandError("dot git-notifications");

/** Open the GitHub notifications view in the Omarchy shell. */
export const notificationsOpenShell = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  yield* executor.run("omarchy-shell", [
    "shell",
    "summon",
    "timmo.git",
    '{"view":"notifications"}',
  ]);
}).pipe(Effect.withSpan("notifications.openShell"), handleNotificationError);

/** CLI text output: --raw notification summary. */
export const notificationsRaw = (opts?: GitNotificationQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshNotificationState(opts);
    yield* writeText(formatRaw(state));
  }).pipe(Effect.withSpan("notifications.raw"), handleNotificationError);

/** Machine output: status bar JSON. */
export const notificationsBarJson = (opts?: GitNotificationQueryOptions) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const executor = yield* CommandExecutor;

    const filteredState = yield* refreshNotificationState({
      ...opts,
      barFilter: true,
    });

    const repositories = yield* Effect.forEach(
      managedGitRepos(config.gitConfig),
      (repo) =>
        Effect.gen(function* () {
          const slugs = yield* managedRepoGitHubSlugs(repo, executor);

          const threads = filteredState.inbox.filter(
            (thread) =>
              thread.unread &&
              slugs.some(
                (slug) => slug.toLowerCase() === thread.repo.toLowerCase(),
              ),
          );

          return {
            path: repo.path,
            repo: repo.github,
            count: threads.length,
            titles: threads.slice(0, 3).map((thread) => thread.title),
          };
        }),
      { concurrency: 4 },
    );

    yield* writeJsonLine({
      ...formatNotificationsBarJson(filteredState),
      workspace: { name: "Dotfiles", path: config.publicDotfiles },
      repositories,
    });
  }).pipe(Effect.withSpan("notifications.barJson"), handleNotificationError);

/** Mark a notification read when opening it from the panel. */
export const notificationsMarkRead = (threadId: string) =>
  Effect.gen(function* () {
    const notifications = yield* GitNotifications;

    const result = yield* notifications.markRead(threadId);
    yield* writeText(`${result.message}\n`);
  }).pipe(Effect.withSpan("notifications.action"), handleNotificationError);

function refreshNotificationState(opts?: GitNotificationQueryOptions) {
  return Effect.gen(function* () {
    const notifications = yield* GitNotifications;

    return yield* notifications.query(opts);
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

/** Format notification state for status bars and the native shell panel. */
export function formatNotificationsBarJson(state: GitNotificationState) {
  const summary = notificationStateSummary(state);

  return {
    text: notificationBarText(state, summary),
    tooltip: formatBarJsonTooltip(state, summary),
    class: notificationBarClass(state, summary),
    allCount: state.totalCount,
    threads: state.threads.map(
      ({ id, repo, title, reason, type, unread, updatedAt, webUrl }) => ({
        id,
        repo,
        title,
        reason,
        type,
        unread,
        updatedAt,
        webUrl,
        important: notificationReasonIsImportant(reason),
      }),
    ),
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

interface NotificationStateSummary {
  readonly unreadCount: number;
  readonly importantUnreadCount: number;
}

function notificationStateSummary(
  state: GitNotificationState,
): NotificationStateSummary {
  let unreadCount = 0;
  let importantUnreadCount = 0;

  for (const thread of state.threads) {
    if (!thread.unread) continue;
    unreadCount += 1;

    if (notificationReasonIsImportant(thread.reason)) importantUnreadCount += 1;
  }

  return { unreadCount, importantUnreadCount };
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
