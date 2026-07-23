import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

describe("OpenCode note mutation contract", () => {
  test.each([
    "agents/.config/opencode/commands/note-create.md",
    "agents/.agents/skills/handoff/SKILL.md",
  ])("leaves date generation to Notes in %s", (path) => {
    const content = read(path);

    expect(content).not.toMatch(/^date:/m);
    expect(content).not.toContain("date -Is");
    expect(content).not.toContain("leave as-is");
  });

  test.each([
    "agents/.config/opencode/commands/note-create.md",
    "agents/.config/opencode/commands/note-append.md",
    "agents/.config/opencode/commands/handoff.md",
  ])("loads the shared Notes MCP contract in %s", (path) => {
    expect(read(path)).toContain("`notes-mcp`");
  });

  test("guards append with the revision returned by note_read", () => {
    const content = read("agents/.config/opencode/commands/note-append.md");

    expect(content).toContain("`expectedHash`: the hash returned by `notes_note_read`");
  });
});
