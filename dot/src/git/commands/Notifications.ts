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
import { notificationReasonIsImportant } from "../services/notificationStatus.js";
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

          const kinds = filteredState.threads
            .filter(
              (thread) =>
                thread.unread &&
                slugs.some(
                  (slug) => slug.toLowerCase() === thread.repo.toLowerCase(),
                ),
            )
            .reduce<Record<NotificationKind, number>>(
              (counts, thread) => {
                counts[notificationKind(thread)] += 1;

                return counts;
              },
              { "needs-you": 0, alert: 0, people: 0, quiet: 0 },
            );

          return {
            path: repo.path,
            repo: repo.github,
            slugs,
            count: threads.length,
            kinds,
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

/** Format notification state for status bars and the native shell panel. */
export function formatNotificationsBarJson(state: GitNotificationState) {
  const summary = notificationStateSummary(state);
  const shown = new Set(state.threads.map((thread) => thread.id));

  return {
    text: notificationBarText(state, summary),
    tooltip: formatBarJsonTooltip(state, summary),
    class: notificationBarClass(state, summary),
    allCount: state.totalCount,
    hiddenBotCount: state.inbox.filter(
      (thread) => thread.bot === true && !shown.has(thread.id),
    ).length,
    threads: state.threads.map((thread) => ({
      id: thread.id,
      repo: thread.repo,
      title: thread.title,
      reason: thread.reason,
      type: thread.type,
      unread: thread.unread,
      bot: thread.bot === true,
      updatedAt: thread.updatedAt,
      webUrl: thread.webUrl,
      important: notificationReasonIsImportant(thread.reason),
      kind: notificationKind(thread),
    })),
  };
}

/** Bar grouping for a notification thread, from most to least actionable. */
export type NotificationKind = "needs-you" | "alert" | "people" | "quiet";

const ALERT_REASONS = new Set(["ci_activity", "security_alert"]);

const ALERT_TYPES = new Set([
  "CheckSuite",
  "WorkflowRun",
  "RepositoryAdvisory",
  "SecurityAdvisory",
]);

/** Classify a thread: requests for you, CI or security problems, people activity, or bots and releases. */
export function notificationKind(
  thread: GitNotificationThread,
): NotificationKind {
  if (ALERT_REASONS.has(thread.reason) || ALERT_TYPES.has(thread.type))
    return "alert";

  if (notificationReasonIsImportant(thread.reason)) return "needs-you";

  if (thread.bot === true || thread.type === "Release") return "quiet";

  return "people";
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

  if (query.barFilter) lines.push("Status-bar filters active");
}
