import { describe, expect, test } from "bun:test";
import { formatRelativeTimeAgo } from "../../../src/git/services/relativeTime.js";

const now = Date.parse("2026-07-10T12:00:00.000Z");

describe("formatRelativeTimeAgo", () => {
  test.each([
    [0, "just now"],
    [4, "just now"],
    [5, "5s ago"],
    [59, "59s ago"],
    [60, "1m ago"],
    [3599, "59m ago"],
    [3600, "1h ago"],
    [86399, "23h ago"],
    [86400, "1d ago"],
  ])("formats %i seconds", (seconds, expected) => {
    expect(
      formatRelativeTimeAgo(new Date(now - seconds * 1000).toISOString(), now),
    ).toBe(expected);
  });

  test("handles invalid and future timestamps", () => {
    expect(formatRelativeTimeAgo(null, now)).toBe("unknown");
    expect(formatRelativeTimeAgo("invalid", now)).toBe("unknown");
    expect(
      formatRelativeTimeAgo(new Date(now + 60_000).toISOString(), now),
    ).toBe("just now");
  });
});
