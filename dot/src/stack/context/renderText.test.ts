import { expect, test } from "bun:test";
import type { StackContextData } from "./model.js";
import { renderStackContextText } from "./renderText.js";

/** Build a stack-context snapshot from the empty defaults. */
function data(over: Partial<StackContextData> = {}): StackContextData {
  return {
    root: "/repo",
    name: "repo",
    scannedFiles: 10,
    truncated: false,
    languages: [],
    ecosystems: [],
    tooling: [],
    frameworks: [],
    warnings: [],
    ...over,
  };
}

test("renders section counts, language percentages, and grouped tooling", () => {
  const text = renderStackContextText(
    data({
      languages: [
        {
          name: "TypeScript",
          files: 3,
          locations: ["src"],
          confidence: "heuristic",
        },
        {
          name: "Markdown",
          files: 1,
          locations: ["."],
          confidence: "heuristic",
        },
      ],
      ecosystems: [
        {
          name: "npm",
          manifests: ["package.json"],
          confidence: "authoritative",
        },
      ],
      tooling: [
        {
          name: "Vitest",
          kinds: ["test runner"],
          evidence: ["npm dep: vitest"],
          confidence: "authoritative",
        },
        {
          name: "Bun",
          kinds: ["package manager"],
          evidence: ["lockfile: bun.lock"],
          confidence: "authoritative",
        },
      ],
      frameworks: [
        {
          name: "Effect",
          via: "npm dep: effect",
          confidence: "authoritative",
        },
      ],
    }),
  );

  expect(text).toContain("Languages (2):");
  expect(text).toContain("TypeScript  3 files (75%)  · src");
  expect(text).toContain("Ecosystems (1):");
  expect(text).toContain("Tooling (2):");
  expect(text).toContain("  package manager:");
  expect(text).toContain("    Bun  package manager  · lockfile: bun.lock");
  expect(text).toContain("  test runner:");
  expect(text).toContain("    Vitest  test runner  · npm dep: vitest");
  expect(text).toContain("Frameworks (1):");
  expect(text).toContain("Effect  npm dep: effect");
});

test("renders empty section placeholders", () => {
  const text = renderStackContextText(data());

  expect(text).toContain("Languages (0):\n  (none detected)");
  expect(text).toContain("Ecosystems (0):\n  (none detected)");
  expect(text).toContain("Tooling (0):\n  (none detected)");
  expect(text).toContain("Frameworks (0):\n  (none detected)");
});

test("applies styling through the provided styler", () => {
  const text = renderStackContextText(
    data({
      languages: [
        {
          name: "TypeScript",
          files: 1,
          locations: ["src"],
          confidence: "heuristic",
        },
      ],
    }),
    {
      heading: (value) => `<h>${value}</h>`,
      label: (value) => `<b>${value}</b>`,
      command: (value) => value,
      dim: (value) => `<d>${value}</d>`,
      success: (value) => value,
      warn: (value) => value,
      markdown: (value) => value,
    },
  );

  expect(text).toContain("<h>Languages (1):</h>");
  expect(text).toContain("<b>TypeScript</b>  1 file (100%)  · src");
});
