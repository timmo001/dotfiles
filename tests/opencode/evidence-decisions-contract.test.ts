import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const evidenceFirstSkill = readFileSync(
  resolve(root, "agents/.agents/skills/evidence-first/SKILL.md"),
  "utf8",
);
const researchSkill = readFileSync(
  resolve(root, "agents/.agents/skills/research/SKILL.md"),
  "utf8",
);

describe("evidence and decisions contract", () => {
  test("checks uncertainty while preserving clear choices", () => {
    for (const contract of [
      "says things like I think, I remember, or I don't think",
      '"reduce the scope"',
      "Verify before answering or acting on it.",
      "Keep the decision, check the reason",
      "Briefly name the source in the answer.",
      "use the question tool",
      "Load `research`",
    ]) {
      expect(evidenceFirstSkill).toContain(contract);
    }
  });

  test("research advertises literal evidence-seeking triggers", () => {
    for (const trigger of [
      "asks why",
      "show evidence",
      "validate this",
      "trusted sources",
    ]) {
      expect(researchSkill).toContain(trigger);
    }
  });
});
