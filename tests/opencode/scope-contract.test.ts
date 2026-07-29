import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const read = (path: string): string =>
  readFileSync(resolve(root, path), "utf8");

describe("changeset scope contract", () => {
  const scope = read("agents/.agents/skills/changeset-scope/SKILL.md");

  test("uses outer code as context without widening review findings", () => {
    expect(scope).toContain(
      "Do not turn issues found in that surrounding context into independent findings or edits.",
    );
    expect(scope).toContain(
      "Report it only when the changed code creates the conflict or concrete duplication",
    );
    expect(scope).toContain(
      "anchor the finding to the changed line, not the unchanged context",
    );
  });

  test("keeps reviews read-only and permits an empty finding set", () => {
    expect(scope).toContain(
      "Reviews remain read-only unless the user separately asks for implementation.",
    );
    expect(scope).toContain(
      "If no scoped finding or safe edit exists, say so rather than substituting adjacent work.",
    );
    expect(scope).toContain(
      "Do not add praise, optional improvements, or nice-to-haves",
    );
  });
});

describe("reviewer contract", () => {
  const reviewer = read("agents/.config/opencode/agents/reviewer.md");
  const reviewSkill = read("agents/.agents/skills/code-review/SKILL.md");
  const reviewCommand = read("agents/.config/opencode/commands/code-review.md");

  test("denies local and external mutation paths", () => {
    for (const denial of [
      "edit: deny",
      "write: deny",
      "apply_patch: deny",
      "cursor_cloud_agent: deny",
      "cursor_delegate: deny",
      "cursor_update_plugin: deny",
      "cloudflare-api_execute: deny",
      "cloudflare-bindings_d1_database_query: deny",
      "system-bridge_system_bridge_media_control: deny",
      "system-bridge_system_bridge_send_notification: deny",
    ]) {
      expect(reviewer).toContain(denial);
    }
  });

  test("does not manufacture review commentary", () => {
    expect(reviewer).toContain(
      "Do not add optional improvements, praise, or nice-to-haves.",
    );
    expect(reviewSkill).toContain(
      "If the changeset has no concrete finding, say so.",
    );
    expect(reviewSkill).not.toContain("Acknowledge good practices");
  });

  test("applies the scope contract before companion review criteria", () => {
    expect(reviewCommand).toContain("Load the `changeset-scope` skill");
    expect(reviewCommand).toContain(
      "narrower explicit user instructions still win",
    );
    expect(reviewer).toContain(
      "Before investigating a review, load `changeset-scope`",
    );
  });
});
