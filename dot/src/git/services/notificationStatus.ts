import type { GitNotificationThread } from "../../types.js";

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
  const time = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(time)) return "unknown";

  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  const units = [
    { max: 60, size: 1, suffix: "s" },
    { max: 3600, size: 60, suffix: "m" },
    { max: 86400, size: 3600, suffix: "h" },
  ];
  if (seconds < 5) return "just now";

  const unit = units.find(({ max }) => seconds < max);
  return unit
    ? `${Math.floor(seconds / unit.size)}${unit.suffix} ago`
    : `${Math.floor(seconds / 86400)}d ago`;
}
