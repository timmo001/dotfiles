import { describe, expect, test } from "bun:test";
import { parseSinceValue } from "../../src/cli/spec.js";

describe("notification --since parsing", () => {
  const now = Date.parse("2024-03-11T16:00:00Z");

  test("accepts every documented relative unit", () => {
    for (const value of [
      "2s",
      "2 sec",
      "2 secs",
      "2 seconds",
      "2m",
      "2 min",
      "2 minutes",
      "2h",
      "2 hr",
      "2 hours",
      "2d",
      "2 days ago",
      "2w",
      "2 weeks",
    ]) {
      expect(parseSinceValue(value, now)).toStartWith("2024-");
    }
  });

  test("accepts epochs and absolute dates and rejects malformed values", () => {
    expect(parseSinceValue("1710000000", now)).toBe("2024-03-09T16:00:00.000Z");
    expect(parseSinceValue("2024-03-09T16:00:00Z", now)).toBe(
      "2024-03-09T16:00:00.000Z",
    );
    expect(() => parseSinceValue("yesterday-ish", now)).toThrow();
  });
});
