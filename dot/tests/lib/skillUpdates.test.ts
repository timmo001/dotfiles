import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GitHub } from "../../src/git/services/GitHub.js";
import { CommandExecutor } from "../../src/services/CommandExecutor.js";
import {
  checkSkill,
  parseSkillMeta,
  parseSkillScanEntry,
  synchroniseSkillFiles,
  type SkillMeta,
} from "../../src/lib/skillUpdates.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dot-skill-updates-"));
  roots.push(root);
  return root;
}

function skillContent(origin: string, sha = "a".repeat(40)): string {
  return `---
name: example
description: Example skill
# origin: ${origin}
# upstream-sha: ${sha}
---

# Example
`;
}

function metaAt(dir: string): SkillMeta {
  const meta = parseSkillMeta(
    skillContent("https://github.com/example/skills/tree/main/example"),
    dir,
  );
  if (!meta) throw new Error("expected valid skill metadata");
  return meta;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("parseSkillScanEntry", () => {
  test("retains malformed origin-tracked skills as errors", () => {
    const entry = parseSkillScanEntry(
      skillContent("https://github.com/example/skills/blob/main/SKILL.md"),
      "/skills/example",
    );

    expect(entry).toEqual({
      type: "invalid-origin",
      meta: {
        name: "example",
        originUrl: "https://github.com/example/skills/blob/main/SKILL.md",
        reason:
          "origin must be a GitHub tree URL with a branch and directory path",
        dir: "/skills/example",
      },
    });
  });
});

describe("checkSkill", () => {
  test("uses the stored SHA cache without fetching content", async () => {
    const meta = metaAt(tempRoot());
    const github = Layer.succeed(GitHub, {
      isAvailable: () => Effect.succeed(true),
      run: () => Effect.die("run should not be called"),
      json: () => Effect.die("json should not be called"),
      api: (endpoint) => {
        expect(endpoint).toContain("commits?path=example");
        return Effect.succeed("a".repeat(40));
      },
    });
    const executor = Layer.succeed(CommandExecutor, {
      run: () => Effect.die("run should not be called"),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.die("exitCode should not be called"),
      inherit: () => Effect.die("inherit should not be called"),
    });

    const result = await Effect.runPromise(
      checkSkill(meta).pipe(Effect.provide(Layer.merge(github, executor))),
    );

    expect(result).toEqual({
      type: "up-to-date",
      cached: true,
      upstreamSha: "a".repeat(40),
    });
  });
});

describe("synchroniseSkillFiles", () => {
  test("mirrors clean imports and removes files deleted upstream", () => {
    const dir = tempRoot();
    mkdirSync(join(dir, "references"));
    writeFileSync(
      join(dir, "SKILL.md"),
      skillContent("https://github.com/example/skills/tree/main/example"),
    );
    writeFileSync(join(dir, "removed.md"), "old");
    writeFileSync(join(dir, "references", "kept.md"), "old");
    const meta = metaAt(dir);
    const sha = "b".repeat(40);

    synchroniseSkillFiles(
      meta,
      sha,
      new Map([
        [
          "SKILL.md",
          "---\nname: upstream\ndescription: Upstream\n---\n\n# Updated\n",
        ],
        ["references/kept.md", "new"],
        ["references/added.md", "added"],
      ]),
    );

    expect(readFileSync(join(dir, "SKILL.md"), "utf-8")).toContain(
      `# upstream-sha: ${sha}`,
    );
    expect(readFileSync(join(dir, "SKILL.md"), "utf-8")).toContain(
      "name: example",
    );
    expect(readFileSync(join(dir, "references", "kept.md"), "utf-8")).toBe(
      "new",
    );
    expect(readFileSync(join(dir, "references", "added.md"), "utf-8")).toBe(
      "added",
    );
    expect(() => readFileSync(join(dir, "removed.md"), "utf-8")).toThrow();
  });
});
