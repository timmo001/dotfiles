import { describe, expect, test } from "bun:test";
import { formatNotificationsBarJson } from "../../../src/git/commands/Notifications.js";
import type {
  GitNotificationState,
  GitNotificationThread,
} from "../../../src/types.js";

const thread = (
  overrides: Partial<GitNotificationThread> = {},
): GitNotificationThread => ({
  id: "123",
  repo: "timmo001/dotfiles",
  repoUrl: "https://github.com/timmo001/dotfiles",
  title: "Review requested",
  type: "PullRequest",
  reason: "review_requested",
  unread: true,
  updatedAt: "2026-08-13T12:00:00Z",
  lastReadAt: null,
  webUrl: "https://github.com/timmo001/dotfiles/pull/1",
  apiUrl: "https://api.github.com/notifications/threads/123",
  subjectApiUrl: "https://api.github.com/repos/timmo001/dotfiles/pulls/1",
  latestCommentApiUrl: null,
  ...overrides,
});

const state = (
  threads: readonly GitNotificationThread[],
  totalCount = threads.length,
): GitNotificationState => ({
  threads,
  totalCount,
  lastChecked: new Date("2026-08-13T12:00:00Z"),
  query: { barFilter: true },
});

describe("formatNotificationsBarJson", () => {
  test("preserves attention state and emits panel-safe threads", () => {
    const output = formatNotificationsBarJson(state([thread()]));
    expect(output).toMatchObject({
      text: " 1",
      class: "notifications-attention",
      allCount: 1,
      threads: [
        {
          id: "123",
          repo: "timmo001/dotfiles",
          reason: "review_requested",
          important: true,
        },
      ],
    });
    expect(output.threads[0]).not.toHaveProperty("apiUrl");
    expect(output.threads[0]).not.toHaveProperty("subjectApiUrl");
  });

  test("includes the count before local bar filters", () => {
    expect(formatNotificationsBarJson(state([thread()], 4)).allCount).toBe(4);
  });

  test("keeps clear and ordinary unread states", () => {
    expect(formatNotificationsBarJson(state([])).class).toBe("hidden");
    expect(
      formatNotificationsBarJson(state([thread({ reason: "subscribed" })]))
        .class,
    ).toBe("notifications-unread");
  });
});
