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
