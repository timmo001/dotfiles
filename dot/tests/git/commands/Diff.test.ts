import { describe, expect, test } from "bun:test";
import { formatDiffBarJson } from "../../../src/git/commands/Diff.js";
import type { DiffRepo } from "../../../src/types.js";

const repo = (overrides: Partial<DiffRepo> = {}): DiffRepo => ({
  name: "dotfiles",
  path: "/private/home/dotfiles",
  category: "dotfiles",
  isDirty: true,
  modified: 2,
  ahead: 0,
  behind: 0,
  ...overrides,
});

describe("formatDiffBarJson", () => {
  test("preserves summary classes and emits panel-safe rows", () => {
    expect(formatDiffBarJson([])).toMatchObject({
      text: " 0",
      class: "dots-ok",
      repos: [],
    });

    const output = formatDiffBarJson([repo()]);
    expect(output).toMatchObject({
      text: " 1",
      class: "dots-attention",
      repos: [
        {
          name: "dotfiles",
          category: "dotfiles",
          modified: 2,
          ahead: 0,
          behind: 0,
        },
      ],
    });
    expect(output.repos[0]).not.toHaveProperty("path");
  });

  test("keeps pull-only and private-only colour states", () => {
    expect(
      formatDiffBarJson([repo({ isDirty: false, modified: 0, behind: 1 })])
        .class,
    ).toBe("dots-pull-only");
    expect(formatDiffBarJson([repo({ name: "private:example" })]).class).toBe(
      "dots-extra-only",
    );
  });
});
