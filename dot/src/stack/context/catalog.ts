/**
 * @file Detection catalog for the stack-context producer.
 *
 * Fixed maps and the framework allowlist that {@link detectStack} keys on. Kept
 * separate from the walk logic so the language/ecosystem/framework coverage can
 * grow without touching the traversal. Framework rules are Vercel-style: keyed
 * on the real package name so a declared dependency maps to a framework without
 * false positives.
 */

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
  { name: "Vite", pkg: "vite", eco: "npm" },
  { name: "Vitest", pkg: "vitest", eco: "npm" },
  { name: "Jest", pkg: "jest", eco: "npm" },
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
