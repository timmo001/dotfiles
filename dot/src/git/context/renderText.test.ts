import { describe, expect, test } from "bun:test";
import { renderBranchContextText } from "./renderText.js";
import type { BranchContextData, CommitRecord } from "./model.js";

function commit(index: number): CommitRecord {
  return {
    isoDate: "2024-01-01T00:00:00Z",
    shortHash: String(index).padStart(7, "0"),
    relativeTime: "1h ago",
    subject: `Commit ${index}`,
    pushed: true,
    files: [],
  };
}

describe("renderBranchContextText", () => {
  test("shows the default today commit cap in the heading", () => {
    const data: BranchContextData = {
      inRepo: true,
      commits: {
        range: {
          args: ["-n", "20", "HEAD"],
          kind: "today",
          total: 24,
          limit: 20,
        },
        records: Array.from({ length: 20 }, (_, index) => commit(index + 1)),
      },
      pullRequest: null,
      warnings: [],
    };

    expect(renderBranchContextText(data)).toContain(
      "Today's commits from 00:00 (20 of 24 commits, max 20; use --since for more, \u2191 local, \u2713 pushed):",
    );
  });
});
