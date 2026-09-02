import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { checkBranchContext } from "../../src/lib/branchContextCheck.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

function write(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

describe("branch-context registration check", () => {
  test("reports missing and mismatched registrations", () => {
    const root = mkdtempSync(join(tmpdir(), "dot-branch-context-"));
    roots.push(root);
    write(
      root,
      "agents/.config/opencode/commands/full.md",
      "Use BranchContextPlugin in full-context mode.",
    );
    write(
      root,
      "agents/.config/opencode/commands/missing.md",
      "Use BranchContextPlugin in work-scope mode.",
    );
    write(
      root,
      "agents/.config/opencode/plugins/branch-context.ts",
      'const BRANCH_CONTEXT_COMMANDS = new Set(["full"]);\nconst WORK_SCOPE_COMMANDS = new Set([]);\n',
    );

    expect(checkBranchContext(root).branchContextIssues).toEqual([
      expect.objectContaining({ command: "missing", mode: "work-scope" }),
    ]);
  });

  test("keeps every public branch-context consumer registered", () => {
    const publicDotfiles = resolve(import.meta.dir, "../../..");
    expect(checkBranchContext(publicDotfiles).branchContextIssues).toEqual([]);
  });
});
