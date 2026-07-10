import { describe, expect, test } from "bun:test";
import type { GitNotificationThread } from "../../../src/types.js";
import {
  formatNotificationIcon,
  formatNotificationThreadDetail,
  notificationReasonIsImportant,
} from "../../../src/git/services/notificationStatus.js";

const thread = (
  overrides: Partial<GitNotificationThread> = {},
): GitNotificationThread => ({
  id: "1",
  repo: "owner/repo",
  repoUrl: "https://github.com/owner/repo",
  title: "Review this",
  type: "PullRequest",
  reason: "subscribed",
  unread: true,
  updatedAt: "2026-07-10T12:00:00.000Z",
  lastReadAt: null,
  webUrl: "https://github.com/owner/repo/pull/1",
  apiUrl: "https://api.github.com/notifications/threads/1",
  subjectApiUrl: null,
  latestCommentApiUrl: null,
  ...overrides,
});

describe("notification status", () => {
  test("classifies important reasons", () => {
    expect(notificationReasonIsImportant("review_requested")).toBe(true);
    expect(notificationReasonIsImportant("security_alert")).toBe(true);
    expect(notificationReasonIsImportant("subscribed")).toBe(false);
  });

  test("formats read, important, and ordinary icons", () => {
    expect(formatNotificationIcon(thread({ unread: false }))).toBe("○");
    expect(formatNotificationIcon(thread({ reason: "mention" }))).toBe("×");
    expect(formatNotificationIcon(thread())).toBe("●");
  });

  test("formats thread details", () => {
    expect(formatNotificationThreadDetail(thread({ updatedAt: null }))).toBe(
      "unread • subscribed • PullRequest • unknown",
    );
  });
});
