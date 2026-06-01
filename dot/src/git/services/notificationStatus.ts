import type { GitNotificationThread } from "../../types.js";
import { formatRelativeTimeAgo } from "./relativeTime.js";

const IMPORTANT_NOTIFICATION_REASONS = new Set([
  "approval_requested",
  "assign",
  "mention",
  "review_requested",
  "security_alert",
  "security_advisory_credit",
  "team_mention",
]);

/** Return whether a notification reason is attention-worthy. */
export function notificationReasonIsImportant(reason: string): boolean {
  return IMPORTANT_NOTIFICATION_REASONS.has(reason);
}

/** Return a compact icon for a notification thread. */
export function formatNotificationIcon(thread: GitNotificationThread): string {
  if (!thread.unread) return "○";
  return notificationReasonIsImportant(thread.reason) ? "×" : "●";
}

/** Return one-line notification status details for list displays. */
export function formatNotificationThreadDetail(
  thread: GitNotificationThread,
): string {
  const status = thread.unread ? "unread" : "read";
  return `${status} • ${thread.reason} • ${thread.type} • ${formatNotificationTimeAgo(thread.updatedAt)}`;
}

/** Format an ISO timestamp as a compact relative time. */
export function formatNotificationTimeAgo(value: string | null): string {
  return formatRelativeTimeAgo(value);
}
