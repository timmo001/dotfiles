/**
 * @file Detection catalog for the stack-context producer.
 *
 * Fixed maps and the framework allowlist that {@link detectStack} keys on. Kept
 * separate from the walk logic so the language/ecosystem/tooling/framework
 * coverage can grow without touching the traversal. Rules are Vercel-style:
 * keyed on real filenames or package names so declared dependencies and config
 * files map to stack signals without false positives.
 */
import type { ToolingKind } from "./model.js";

/** Directory names skipped by the walk (heavy, derived, or vendored trees). */
export const IGNORE_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".astro",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".gradle",
  ".idea",
  ".vscode-test",
  "coverage",
  ".terraform",
  "Pods",
]);

/** File extension (lowercase, with dot) -> language for the census. */
export const EXT_LANG: Readonly<Record<string, string>> = {
  ".ts": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".jsx": "JavaScript",
  ".py": "Python",
  ".pyi": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".rb": "Ruby",
  ".php": "PHP",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".swift": "Swift",
  ".scala": "Scala",
  ".dart": "Dart",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".clj": "Clojure",
  ".hs": "Haskell",
  ".ml": "OCaml",
  ".jl": "Julia",
  ".r": "R",
  ".c": "C",
  ".h": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".cxx": "C++",
  ".hpp": "C++",
  ".hh": "C++",
  ".cs": "C#",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".fish": "Shell",
  ".ps1": "PowerShell",
  ".zig": "Zig",
  ".lua": "Lua",
  ".nix": "Nix",
  ".sql": "SQL",
  ".tf": "Terraform",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".astro": "Astro",
  ".css": "CSS",
  ".scss": "SCSS",
  ".less": "Less",
  ".html": "HTML",
  ".md": "Markdown",
  ".mdx": "MDX",
  ".json": "JSON",
  ".yml": "YAML",
  ".yaml": "YAML",
  ".toml": "TOML",
};

/** Exact filename -> language, for languages identified by name not extension. */
export const FILENAME_LANG: Readonly<Record<string, string>> = {
  Dockerfile: "Dockerfile",
  Containerfile: "Dockerfile",
  Makefile: "Makefile",
  "CMakeLists.txt": "CMake",
  Justfile: "Just",
  justfile: "Just",
};

/** Manifest/lock filename -> ecosystem, for authoritative ecosystem detection. */
export const MANIFEST_ECO: Readonly<Record<string, string>> = {
  "package.json": "npm",
  "go.mod": "go",
  "Cargo.toml": "cargo",
  "pyproject.toml": "python",
  "requirements.txt": "python",
  "setup.py": "python",
  Pipfile: "python",
  "composer.json": "composer",
  Gemfile: "rubygems",
  "pom.xml": "maven",
  "build.gradle": "gradle",
  "build.gradle.kts": "gradle",
  "pubspec.yaml": "pub",
  "mix.exs": "hex",
  "Package.swift": "swiftpm",
};

/** Tool category constants reused by the tooling detection catalog. */
export const TOOL_KIND = {
  packageManager: "package manager",
  linter: "linter",
  formatter: "formatter",
  taskRunner: "task runner",
  buildTool: "build tool",
  testRunner: "test runner",
  gitHook: "git hook",
  releaseTool: "release tool",
} as const satisfies Readonly<Record<string, ToolingKind>>;

/** A development-tool signal keyed by package name, config filename, or lockfile. */
export interface ToolingRule {
  /** Tool display name. */
  readonly name: string;
  /** Broad tool categories this rule contributes. */
  readonly kinds: readonly ToolingKind[];
}

/** Lockfile/manager file -> package-manager rule. */
export const LOCKFILE_TOOLING: Readonly<Record<string, ToolingRule>> = {
  "bun.lock": { name: "Bun", kinds: [TOOL_KIND.packageManager] },
  "bun.lockb": { name: "Bun", kinds: [TOOL_KIND.packageManager] },
  "pnpm-lock.yaml": { name: "pnpm", kinds: [TOOL_KIND.packageManager] },
  "package-lock.json": { name: "npm", kinds: [TOOL_KIND.packageManager] },
  "npm-shrinkwrap.json": { name: "npm", kinds: [TOOL_KIND.packageManager] },
  "yarn.lock": { name: "Yarn", kinds: [TOOL_KIND.packageManager] },
  "Cargo.lock": { name: "Cargo", kinds: [TOOL_KIND.packageManager] },
  "go.sum": { name: "Go modules", kinds: [TOOL_KIND.packageManager] },
  "poetry.lock": { name: "Poetry", kinds: [TOOL_KIND.packageManager] },
  "uv.lock": { name: "uv", kinds: [TOOL_KIND.packageManager] },
  "Pipfile.lock": { name: "Pipenv", kinds: [TOOL_KIND.packageManager] },
  "composer.lock": { name: "Composer", kinds: [TOOL_KIND.packageManager] },
  "Gemfile.lock": { name: "Bundler", kinds: [TOOL_KIND.packageManager] },
  "pubspec.lock": { name: "pub", kinds: [TOOL_KIND.packageManager] },
  "mix.lock": { name: "Mix", kinds: [TOOL_KIND.packageManager] },
  "Package.resolved": {
    name: "Swift Package Manager",
    kinds: [TOOL_KIND.packageManager],
  },
};

/** Manifest files that also identify a non-npm package manager. */
export const MANIFEST_TOOLING: Readonly<Record<string, ToolingRule>> = {
  "go.mod": { name: "Go modules", kinds: [TOOL_KIND.packageManager] },
  "Cargo.toml": { name: "Cargo", kinds: [TOOL_KIND.packageManager] },
  "composer.json": { name: "Composer", kinds: [TOOL_KIND.packageManager] },
  Gemfile: { name: "Bundler", kinds: [TOOL_KIND.packageManager] },
  "pubspec.yaml": { name: "pub", kinds: [TOOL_KIND.packageManager] },
  "mix.exs": { name: "Mix", kinds: [TOOL_KIND.packageManager] },
  "Package.swift": {
    name: "Swift Package Manager",
    kinds: [TOOL_KIND.packageManager],
  },
};

/** Exact config filename -> tooling rule. */
export const CONFIG_TOOLING: Readonly<Record<string, ToolingRule>> = {
  "biome.json": {
    name: "Biome",
    kinds: [TOOL_KIND.linter, TOOL_KIND.formatter],
  },
  "biome.jsonc": {
    name: "Biome",
    kinds: [TOOL_KIND.linter, TOOL_KIND.formatter],
  },
  ".eslintrc": { name: "ESLint", kinds: [TOOL_KIND.linter] },
  ".eslintrc.cjs": { name: "ESLint", kinds: [TOOL_KIND.linter] },
  ".eslintrc.js": { name: "ESLint", kinds: [TOOL_KIND.linter] },
  ".eslintrc.json": { name: "ESLint", kinds: [TOOL_KIND.linter] },
  ".eslintrc.yaml": { name: "ESLint", kinds: [TOOL_KIND.linter] },
  ".eslintrc.yml": { name: "ESLint", kinds: [TOOL_KIND.linter] },
  "eslint.config.cjs": { name: "ESLint", kinds: [TOOL_KIND.linter] },
  "eslint.config.js": { name: "ESLint", kinds: [TOOL_KIND.linter] },
  "eslint.config.mjs": { name: "ESLint", kinds: [TOOL_KIND.linter] },
  "eslint.config.ts": { name: "ESLint", kinds: [TOOL_KIND.linter] },
  ".oxlintrc.json": { name: "oxlint", kinds: [TOOL_KIND.linter] },
  ".stylelintrc": { name: "Stylelint", kinds: [TOOL_KIND.linter] },
  ".stylelintrc.cjs": { name: "Stylelint", kinds: [TOOL_KIND.linter] },
  ".stylelintrc.js": { name: "Stylelint", kinds: [TOOL_KIND.linter] },
  ".stylelintrc.json": { name: "Stylelint", kinds: [TOOL_KIND.linter] },
  ".golangci.yml": { name: "golangci-lint", kinds: [TOOL_KIND.linter] },
  ".golangci.yaml": { name: "golangci-lint", kinds: [TOOL_KIND.linter] },
  "ruff.toml": { name: "Ruff", kinds: [TOOL_KIND.linter, TOOL_KIND.formatter] },
  ".ruff.toml": {
    name: "Ruff",
    kinds: [TOOL_KIND.linter, TOOL_KIND.formatter],
  },
  "clippy.toml": { name: "Clippy", kinds: [TOOL_KIND.linter] },
  ".clippy.toml": { name: "Clippy", kinds: [TOOL_KIND.linter] },
  "rustfmt.toml": { name: "rustfmt", kinds: [TOOL_KIND.formatter] },
  ".rustfmt.toml": { name: "rustfmt", kinds: [TOOL_KIND.formatter] },
  ".prettierrc": { name: "Prettier", kinds: [TOOL_KIND.formatter] },
  ".prettierrc.cjs": { name: "Prettier", kinds: [TOOL_KIND.formatter] },
  ".prettierrc.js": { name: "Prettier", kinds: [TOOL_KIND.formatter] },
  ".prettierrc.json": { name: "Prettier", kinds: [TOOL_KIND.formatter] },
  ".prettierrc.mjs": { name: "Prettier", kinds: [TOOL_KIND.formatter] },
  ".prettierrc.yaml": { name: "Prettier", kinds: [TOOL_KIND.formatter] },
  ".prettierrc.yml": { name: "Prettier", kinds: [TOOL_KIND.formatter] },
  "prettier.config.cjs": { name: "Prettier", kinds: [TOOL_KIND.formatter] },
  "prettier.config.js": { name: "Prettier", kinds: [TOOL_KIND.formatter] },
  "prettier.config.mjs": { name: "Prettier", kinds: [TOOL_KIND.formatter] },
  "dprint.json": { name: "dprint", kinds: [TOOL_KIND.formatter] },
  "dprint.jsonc": { name: "dprint", kinds: [TOOL_KIND.formatter] },
  "mise.toml": { name: "mise", kinds: [TOOL_KIND.taskRunner] },
  ".mise.toml": { name: "mise", kinds: [TOOL_KIND.taskRunner] },
  "mise.yaml": { name: "mise", kinds: [TOOL_KIND.taskRunner] },
  "mise.yml": { name: "mise", kinds: [TOOL_KIND.taskRunner] },
  Justfile: { name: "just", kinds: [TOOL_KIND.taskRunner] },
  justfile: { name: "just", kinds: [TOOL_KIND.taskRunner] },
  Makefile: { name: "make", kinds: [TOOL_KIND.taskRunner] },
  "Taskfile.yml": { name: "Task", kinds: [TOOL_KIND.taskRunner] },
  "Taskfile.yaml": { name: "Task", kinds: [TOOL_KIND.taskRunner] },
  "lefthook.yml": { name: "Lefthook", kinds: [TOOL_KIND.gitHook] },
  "lefthook.yaml": { name: "Lefthook", kinds: [TOOL_KIND.gitHook] },
  "commitlint.config.cjs": { name: "commitlint", kinds: [TOOL_KIND.gitHook] },
  "commitlint.config.js": { name: "commitlint", kinds: [TOOL_KIND.gitHook] },
  "commitlint.config.mjs": { name: "commitlint", kinds: [TOOL_KIND.gitHook] },
  "commitlint.config.ts": { name: "commitlint", kinds: [TOOL_KIND.gitHook] },
  ".releaserc": { name: "semantic-release", kinds: [TOOL_KIND.releaseTool] },
  ".releaserc.json": {
    name: "semantic-release",
    kinds: [TOOL_KIND.releaseTool],
  },
  ".releaserc.yaml": {
    name: "semantic-release",
    kinds: [TOOL_KIND.releaseTool],
  },
  ".releaserc.yml": {
    name: "semantic-release",
    kinds: [TOOL_KIND.releaseTool],
  },
  ".releaserc.js": { name: "semantic-release", kinds: [TOOL_KIND.releaseTool] },
  ".releaserc.cjs": {
    name: "semantic-release",
    kinds: [TOOL_KIND.releaseTool],
  },
  "release.config.js": {
    name: "semantic-release",
    kinds: [TOOL_KIND.releaseTool],
  },
  "release.config.cjs": {
    name: "semantic-release",
    kinds: [TOOL_KIND.releaseTool],
  },
  "release-please-config.json": {
    name: "release-please",
    kinds: [TOOL_KIND.releaseTool],
  },
  ".changeset/config.json": {
    name: "Changesets",
    kinds: [TOOL_KIND.releaseTool],
  },
  "turbo.json": { name: "Turborepo", kinds: [TOOL_KIND.taskRunner] },
  "nx.json": { name: "Nx", kinds: [TOOL_KIND.taskRunner] },
  "vite.config.cjs": { name: "Vite", kinds: [TOOL_KIND.buildTool] },
  "vite.config.js": { name: "Vite", kinds: [TOOL_KIND.buildTool] },
  "vite.config.mjs": { name: "Vite", kinds: [TOOL_KIND.buildTool] },
  "vite.config.ts": { name: "Vite", kinds: [TOOL_KIND.buildTool] },
  "webpack.config.cjs": { name: "webpack", kinds: [TOOL_KIND.buildTool] },
  "webpack.config.js": { name: "webpack", kinds: [TOOL_KIND.buildTool] },
  "webpack.config.mjs": { name: "webpack", kinds: [TOOL_KIND.buildTool] },
  "rollup.config.cjs": { name: "Rollup", kinds: [TOOL_KIND.buildTool] },
  "rollup.config.js": { name: "Rollup", kinds: [TOOL_KIND.buildTool] },
  "rollup.config.mjs": { name: "Rollup", kinds: [TOOL_KIND.buildTool] },
  "rollup.config.ts": { name: "Rollup", kinds: [TOOL_KIND.buildTool] },
  "tsup.config.ts": { name: "tsup", kinds: [TOOL_KIND.buildTool] },
  "tsup.config.js": { name: "tsup", kinds: [TOOL_KIND.buildTool] },
  "vitest.config.cjs": { name: "Vitest", kinds: [TOOL_KIND.testRunner] },
  "vitest.config.js": { name: "Vitest", kinds: [TOOL_KIND.testRunner] },
  "vitest.config.mjs": { name: "Vitest", kinds: [TOOL_KIND.testRunner] },
  "vitest.config.ts": { name: "Vitest", kinds: [TOOL_KIND.testRunner] },
  "jest.config.cjs": { name: "Jest", kinds: [TOOL_KIND.testRunner] },
  "jest.config.js": { name: "Jest", kinds: [TOOL_KIND.testRunner] },
  "jest.config.mjs": { name: "Jest", kinds: [TOOL_KIND.testRunner] },
  "jest.config.ts": { name: "Jest", kinds: [TOOL_KIND.testRunner] },
  "playwright.config.ts": { name: "Playwright", kinds: [TOOL_KIND.testRunner] },
  "playwright.config.js": { name: "Playwright", kinds: [TOOL_KIND.testRunner] },
  "cypress.config.ts": { name: "Cypress", kinds: [TOOL_KIND.testRunner] },
  "cypress.config.js": { name: "Cypress", kinds: [TOOL_KIND.testRunner] },
};

/** npm package name -> tooling rule. */
export const NPM_TOOLING: Readonly<Record<string, ToolingRule>> = {
  bun: { name: "Bun", kinds: [TOOL_KIND.packageManager] },
  pnpm: { name: "pnpm", kinds: [TOOL_KIND.packageManager] },
  yarn: { name: "Yarn", kinds: [TOOL_KIND.packageManager] },
  npm: { name: "npm", kinds: [TOOL_KIND.packageManager] },
  eslint: { name: "ESLint", kinds: [TOOL_KIND.linter] },
  oxlint: { name: "oxlint", kinds: [TOOL_KIND.linter] },
  "@biomejs/biome": {
    name: "Biome",
    kinds: [TOOL_KIND.linter, TOOL_KIND.formatter],
  },
  stylelint: { name: "Stylelint", kinds: [TOOL_KIND.linter] },
  prettier: { name: "Prettier", kinds: [TOOL_KIND.formatter] },
  dprint: { name: "dprint", kinds: [TOOL_KIND.formatter] },
  lefthook: { name: "Lefthook", kinds: [TOOL_KIND.gitHook] },
  "lint-staged": { name: "lint-staged", kinds: [TOOL_KIND.gitHook] },
  "@commitlint/cli": { name: "commitlint", kinds: [TOOL_KIND.gitHook] },
  "semantic-release": {
    name: "semantic-release",
    kinds: [TOOL_KIND.releaseTool],
  },
  "release-please": { name: "release-please", kinds: [TOOL_KIND.releaseTool] },
  "@changesets/cli": { name: "Changesets", kinds: [TOOL_KIND.releaseTool] },
  mise: { name: "mise", kinds: [TOOL_KIND.taskRunner] },
  just: { name: "just", kinds: [TOOL_KIND.taskRunner] },
  turbo: { name: "Turborepo", kinds: [TOOL_KIND.taskRunner] },
  nx: { name: "Nx", kinds: [TOOL_KIND.taskRunner] },
  vite: { name: "Vite", kinds: [TOOL_KIND.buildTool] },
  webpack: { name: "webpack", kinds: [TOOL_KIND.buildTool] },
  rollup: { name: "Rollup", kinds: [TOOL_KIND.buildTool] },
  esbuild: { name: "esbuild", kinds: [TOOL_KIND.buildTool] },
  tsup: { name: "tsup", kinds: [TOOL_KIND.buildTool] },
  parcel: { name: "Parcel", kinds: [TOOL_KIND.buildTool] },
  vitest: { name: "Vitest", kinds: [TOOL_KIND.testRunner] },
  jest: { name: "Jest", kinds: [TOOL_KIND.testRunner] },
  playwright: { name: "Playwright", kinds: [TOOL_KIND.testRunner] },
  "@playwright/test": { name: "Playwright", kinds: [TOOL_KIND.testRunner] },
  cypress: { name: "Cypress", kinds: [TOOL_KIND.testRunner] },
};

/** package.json `packageManager` field value prefix -> package-manager rule. */
export const PACKAGE_MANAGER_FIELD_TOOLING: Readonly<
  Record<string, ToolingRule>
> = {
  bun: { name: "Bun", kinds: [TOOL_KIND.packageManager] },
  npm: { name: "npm", kinds: [TOOL_KIND.packageManager] },
  pnpm: { name: "pnpm", kinds: [TOOL_KIND.packageManager] },
  yarn: { name: "Yarn", kinds: [TOOL_KIND.packageManager] },
};

/** A tooling signal matched from a non-npm manifest package token. */
export interface TextToolingRule extends ToolingRule {
  /** Ecosystem the package token belongs to. */
  readonly eco: string;
  /** Exact package token to match in manifest text. */
  readonly pkg: string;
}

/** Tooling rules for ecosystems where manifests are scanned as text. */
export const TEXT_TOOLING: readonly TextToolingRule[] = [
  {
    name: "pytest",
    kinds: [TOOL_KIND.testRunner],
    eco: "python",
    pkg: "pytest",
  },
  {
    name: "Ruff",
    kinds: [TOOL_KIND.linter, TOOL_KIND.formatter],
    eco: "python",
    pkg: "ruff",
  },
  { name: "Black", kinds: [TOOL_KIND.formatter], eco: "python", pkg: "black" },
];

/** A framework signal: a package name in an ecosystem maps to a framework. */
export interface FrameworkRule {
  /** Framework display name. */
  readonly name: string;
  /** Exact dependency/package name to match. */
  readonly pkg: string;
  /** Ecosystem the package belongs to. */
  readonly eco: string;
}

/**
 * Framework allowlist. Covers the maintainer's actual stacks first, then common
 * ones. Deliberately finite and keyed on the real package name; extend as new
 * stacks appear rather than loosening the match.
 */
export const FRAMEWORKS: readonly FrameworkRule[] = [
  // JS / TS
  { name: "Astro", pkg: "astro", eco: "npm" },
  { name: "Starlight", pkg: "@astrojs/starlight", eco: "npm" },
  { name: "Next.js", pkg: "next", eco: "npm" },
  { name: "Nuxt", pkg: "nuxt", eco: "npm" },
  { name: "Remix", pkg: "@remix-run/react", eco: "npm" },
  { name: "React", pkg: "react", eco: "npm" },
  { name: "Vue", pkg: "vue", eco: "npm" },
  { name: "Svelte", pkg: "svelte", eco: "npm" },
  { name: "SvelteKit", pkg: "@sveltejs/kit", eco: "npm" },
  { name: "SolidJS", pkg: "solid-js", eco: "npm" },
  { name: "Angular", pkg: "@angular/core", eco: "npm" },
  { name: "Lit", pkg: "lit", eco: "npm" },
  { name: "Effect", pkg: "effect", eco: "npm" },
  { name: "OpenTUI", pkg: "@opentui/core", eco: "npm" },
  { name: "Ink", pkg: "ink", eco: "npm" },
  { name: "Express", pkg: "express", eco: "npm" },
  { name: "Fastify", pkg: "fastify", eco: "npm" },
  { name: "NestJS", pkg: "@nestjs/core", eco: "npm" },
  { name: "Hono", pkg: "hono", eco: "npm" },
  { name: "Tailwind CSS", pkg: "tailwindcss", eco: "npm" },
  { name: "Electron", pkg: "electron", eco: "npm" },
  { name: "Tauri", pkg: "@tauri-apps/api", eco: "npm" },
  // Python
  { name: "Django", pkg: "django", eco: "python" },
  { name: "Flask", pkg: "flask", eco: "python" },
  { name: "FastAPI", pkg: "fastapi", eco: "python" },
  { name: "Home Assistant", pkg: "homeassistant", eco: "python" },
  { name: "pytest", pkg: "pytest", eco: "python" },
  // Go
  { name: "Cobra", pkg: "github.com/spf13/cobra", eco: "go" },
  { name: "Gin", pkg: "github.com/gin-gonic/gin", eco: "go" },
  { name: "Echo", pkg: "github.com/labstack/echo", eco: "go" },
  { name: "Fiber", pkg: "github.com/gofiber/fiber", eco: "go" },
  { name: "Bubble Tea", pkg: "github.com/charmbracelet/bubbletea", eco: "go" },
  // Rust
  { name: "Tokio", pkg: "tokio", eco: "cargo" },
  { name: "Actix Web", pkg: "actix-web", eco: "cargo" },
  { name: "Axum", pkg: "axum", eco: "cargo" },
  { name: "Serde", pkg: "serde", eco: "cargo" },
];

/** Framework rules indexed by `${eco}:${pkg}` for O(1) lookup. */
export const FRAMEWORK_INDEX: ReadonlyMap<string, FrameworkRule> = new Map(
  FRAMEWORKS.map((rule) => [`${rule.eco}:${rule.pkg}`, rule]),
);

/** Ecosystems whose framework rules are matched by scanning manifest text. */
export const TEXT_SCANNED_ECOSYSTEMS: readonly string[] = [
  "go",
  "cargo",
  "python",
];
