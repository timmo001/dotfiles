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
let nonGitDir: string;

/** Run a git command in the test repository. */
function git(args: readonly string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "stack-detect-"));
  nonGitDir = mkdtempSync(join(tmpdir(), "stack-detect-nongit-"));
  git(["init"]);
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      packageManager: "bun@1.2.0",
      dependencies: { astro: "^4.0.0", effect: "^3.0.0", vite: "^7.0.0" },
      devDependencies: {
        prettier: "^3.0.0",
        typescript: "^5.0.0",
        vitest: "^3.0.0",
        "@changesets/cli": "^2.29.0",
        "@commitlint/cli": "^19.0.0",
        "lint-staged": "^15.0.0",
        "release-please": "^16.0.0",
      },
    }),
  );
  writeFileSync(join(dir, "bun.lock"), "");
  writeFileSync(join(dir, ".prettierrc"), "{}\n");
  writeFileSync(join(dir, "lefthook.yml"), "pre-commit:\n");
  writeFileSync(join(dir, "release-please-config.json"), "{}\n");
  writeFileSync(join(dir, "mise.toml"), "[tasks]\n");
  writeFileSync(join(dir, "vite.config.ts"), "export default {};\n");
  mkdirSync(join(dir, ".changeset"), { recursive: true });
  writeFileSync(join(dir, ".changeset", "config.json"), "{}\n");
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
  rmSync(nonGitDir, { recursive: true, force: true });
});

test("censuses languages by extension and respects gitignore", () => {
  const data = detectStack(options(dir));
  const files = new Map(data.languages.map((lang) => [lang.name, lang.files]));
  expect(files.get("TypeScript")).toBe(3); // source files + vite config, not the ignored one
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
  expect(frameworks.has("Vite")).toBe(false);
});

test("detects tooling from lockfiles, configs, and declared dependencies", () => {
  const tooling = new Map(
    detectStack(options(dir)).tooling.map((tool) => [tool.name, tool]),
  );
  expect(tooling.get("Bun")?.kinds).toContain("package manager");
  expect(tooling.get("Prettier")?.kinds).toContain("formatter");
  expect(tooling.get("mise")?.kinds).toContain("task runner");
  expect(tooling.get("Vite")?.kinds).toContain("build tool");
  expect(tooling.get("Vitest")?.kinds).toContain("test runner");
  expect(tooling.get("Lefthook")?.kinds).toContain("git hook");
  expect(tooling.get("lint-staged")?.kinds).toContain("git hook");
  expect(tooling.get("commitlint")?.kinds).toContain("git hook");
  expect(tooling.get("release-please")?.kinds).toContain("release tool");
  expect(tooling.get("Changesets")?.kinds).toContain("release tool");
  expect(tooling.get("Vite")?.evidence).toContain("npm dep: vite");
  expect(tooling.get("Changesets")?.evidence).toContain(
    "config: .changeset/config.json",
  );
});

test("returns a warning and no results for a non-directory root", () => {
  const data = detectStack(options(join(dir, "does-not-exist")));
  expect(data.languages).toHaveLength(0);
  expect(data.ecosystems).toHaveLength(0);
  expect(data.tooling).toHaveLength(0);
  expect(data.warnings.length).toBeGreaterThan(0);
});

test("returns a warning and no results outside a git worktree", () => {
  writeFileSync(join(nonGitDir, "package.json"), JSON.stringify({}));
  writeFileSync(join(nonGitDir, "index.ts"), "export const x = 1;\n");
  const data = detectStack(options(nonGitDir));
  expect(data.scannedFiles).toBe(0);
  expect(data.languages).toHaveLength(0);
  expect(data.ecosystems).toHaveLength(0);
  expect(data.tooling).toHaveLength(0);
  expect(data.warnings.join("\n")).toContain("No readable Git worktree");
});

test("marks the result truncated when the file cap is hit", () => {
  const data = detectStack(options(dir, { maxFiles: 1 }));
  expect(data.truncated).toBe(true);
});
