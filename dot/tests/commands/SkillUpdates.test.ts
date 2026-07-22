import { describe, expect, test } from "bun:test";
import { reportItem } from "../../src/commands/SkillUpdates.js";
import type { SkillMeta } from "../../src/lib/skillUpdates.js";

const meta: SkillMeta = {
  name: "example",
  description: "Example",
  origin: {
    owner: "example",
    repo: "skills",
    branch: "main",
    path: "example",
    type: "directory",
  },
  originUrl: "https://github.com/example/skills/tree/main/example",
  storedSha: "a".repeat(40),
  localEdits: [],
  dir: "/skills/example",
};

describe("reportItem", () => {
  test("serialises clean updates without diff previews", () => {
    expect(
      reportItem(meta, {
        type: "changes",
        files: [
          {
            path: "SKILL.md",
            status: "modified",
            diffPreview: "large diff",
          },
        ],
        summary: "changed",
        upstreamSha: "b".repeat(40),
        writeSha: "b".repeat(40),
      }),
    ).toEqual({
      name: "example",
      directory: "example",
      state: "update-available",
      origin: meta.originUrl,
      storedSha: "a".repeat(40),
      upstreamSha: "b".repeat(40),
      files: [{ path: "SKILL.md", status: "modified" }],
      localEdits: [],
    });
  });

  test("marks adapted skills for manual review", () => {
    expect(
      reportItem(
        { ...meta, localEdits: ["Keep local wording"] },
        {
          type: "local-edits",
          files: [],
          summary: "changed",
          upstreamSha: "b".repeat(40),
          writeSha: "b".repeat(40),
        },
      ).state,
    ).toBe("manual-review");
  });
});
