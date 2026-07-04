import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectStack } from "./detect.js";
import { STACK_CONTEXT_DEFAULTS, type StackContextOptions } from "./model.js";

/** Build full options for a scan root from the defaults. */
function options(
  root: string,
  over: Partial<StackContextOptions> = {},
): StackContextOptions {
  return { root, ...STACK_CONTEXT_DEFAULTS, ...over };
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "stack-detect-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      dependencies: { astro: "^4.0.0", effect: "^3.0.0" },
      devDependencies: { typescript: "^5.0.0" },
    }),
  );
  writeFileSync(
    join(dir, "go.mod"),
    "module example.com/x\n\nrequire github.com/spf13/cobra v1.8.0\n",
  );
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "src", "app.tsx"), "export const A = () => null;\n");
  mkdirSync(join(dir, "cmd"), { recursive: true });
  writeFileSync(join(dir, "cmd", "main.go"), "package main\n");
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "name: ci\n");
  writeFileSync(join(dir, "README.md"), "# Test\n");
  // Ignored tree: must not be censused.
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(
    join(dir, "node_modules", "ignored.ts"),
    "export const ignored = 1;\n",
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("censuses languages by extension and ignores node_modules", () => {
  const data = detectStack(options(dir));
  const files = new Map(data.languages.map((lang) => [lang.name, lang.files]));
  expect(files.get("TypeScript")).toBe(2); // index.ts + app.tsx, not the ignored one
  expect(files.get("Go")).toBe(1);
  expect(files.get("Markdown")).toBe(1);
  expect(data.languages.every((lang) => lang.confidence === "heuristic")).toBe(
    true,
  );
  const tsLocations =
    data.languages.find((lang) => lang.name === "TypeScript")?.locations ?? [];
  expect(tsLocations).toContain("src");
});

test("detects ecosystems from manifests and workflows", () => {
  const names = detectStack(options(dir)).ecosystems.map((eco) => eco.name);
  expect(names).toContain("npm");
  expect(names).toContain("go");
  expect(names).toContain("github-actions");
});

test("detects frameworks with the right confidence per source", () => {
  const frameworks = new Map(
    detectStack(options(dir)).frameworks.map((fw) => [fw.name, fw.confidence]),
  );
  expect(frameworks.get("Astro")).toBe("authoritative"); // parsed npm dep
  expect(frameworks.get("Effect")).toBe("authoritative");
  expect(frameworks.get("Cobra")).toBe("strong"); // go manifest text scan
});

test("returns a warning and no results for a non-directory root", () => {
  const data = detectStack(options(join(dir, "does-not-exist")));
  expect(data.languages).toHaveLength(0);
  expect(data.ecosystems).toHaveLength(0);
  expect(data.warnings.length).toBeGreaterThan(0);
});

test("marks the result truncated when the file cap is hit", () => {
  const data = detectStack(options(dir, { maxFiles: 1 }));
  expect(data.truncated).toBe(true);
});
