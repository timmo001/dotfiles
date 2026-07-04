/**
 * @file Data model and options for the shared stack-context producer.
 *
 * `detectStack` (see `detect.ts`) walks the target directory once and produces a
 * single {@link StackContextData} snapshot: detected languages (with their
 * general locations), package ecosystems (from manifests), tooling (from
 * lockfiles, configs, and declared dependencies), and frameworks (from declared
 * dependencies). The text renderer (`dot stack-context`) and the JSON renderer
 * (consumed by the OpenCode stack-context plugin) both format that one snapshot,
 * so the two consumers can never drift. Detection is pure filesystem work: no
 * subprocess and no external dependency, which is why it stays sub-25ms even on
 * large repositories (see the Phase 0 benchmark).
 */

/** Confidence in a detected signal. */
export type StackConfidence = "authoritative" | "strong" | "heuristic";

/** Which target to scan and the walk safety caps. */
export interface StackContextOptions {
  /** Absolute directory to scan (the repository or working directory). */
  readonly root: string;
  /** Maximum directory depth to descend below {@link root}. */
  readonly maxDepth: number;
  /** Cap on files visited before the walk stops and marks the result truncated. */
  readonly maxFiles: number;
  /** Number of general locations listed per language, most files first. */
  readonly topLocations: number;
}

/** Walk caps applied when the caller does not override them. */
export const STACK_CONTEXT_DEFAULTS = {
  maxDepth: 12,
  maxFiles: 200_000,
  topLocations: 4,
} as const satisfies Omit<StackContextOptions, "root">;

/** A detected language, its file count, and its top general locations. */
export interface LanguageEntry {
  /** Language name (e.g. `TypeScript`). */
  readonly name: string;
  /** Number of files attributed to this language. */
  readonly files: number;
  /** Top general locations (up to 2 leading path segments), most files first. */
  readonly locations: readonly string[];
  /** Always `heuristic`: derived from an extension/filename census. */
  readonly confidence: StackConfidence;
}

/** A detected package ecosystem and the manifests that evidence it. */
export interface EcosystemEntry {
  /** Ecosystem name (e.g. `npm`, `go`, `cargo`, `python`, `github-actions`). */
  readonly name: string;
  /** Repository-relative manifest paths, capped for size. */
  readonly manifests: readonly string[];
  /** Always `authoritative`: manifest/config file presence. */
  readonly confidence: StackConfidence;
}

/** A detected framework/library and what signalled it. */
export interface FrameworkEntry {
  /** Framework display name (e.g. `Astro`, `Effect`, `Lit`). */
  readonly name: string;
  /** What signalled it, e.g. `npm dep: effect`. */
  readonly via: string;
  /** `authoritative` for parsed npm deps, `strong` for text-matched manifests. */
  readonly confidence: StackConfidence;
}

/** Broad category for a detected development tool. */
export type ToolingKind =
  | "package manager"
  | "linter"
  | "formatter"
  | "task runner"
  | "build tool"
  | "test runner"
  | "git hook"
  | "release tool";

/** A detected tool, its categories, and what evidenced it. */
export interface ToolingEntry {
  /** Tool display name (e.g. `Bun`, `Prettier`, `Vite`). */
  readonly name: string;
  /** Tool categories; tools like Biome can span multiple categories. */
  readonly kinds: readonly ToolingKind[];
  /** Evidence strings, e.g. `lockfile: bun.lock` or `npm dep: vite`. */
  readonly evidence: readonly string[];
  /** Always `authoritative`: lockfile, config file, or declared dependency. */
  readonly confidence: StackConfidence;
}

/** Full structured stack-context snapshot. */
export interface StackContextData {
  /** Absolute directory that was scanned. */
  readonly root: string;
  /** Directory name of {@link root}, for a readable header. */
  readonly name: string;
  /** Total files visited during the walk. */
  readonly scannedFiles: number;
  /** Whether the walk stopped early on {@link StackContextOptions.maxFiles}. */
  readonly truncated: boolean;
  /** Detected languages, most files first. */
  readonly languages: readonly LanguageEntry[];
  /** Detected package ecosystems. */
  readonly ecosystems: readonly EcosystemEntry[];
  /** Detected development tooling. */
  readonly tooling: readonly ToolingEntry[];
  /** Detected frameworks/libraries. */
  readonly frameworks: readonly FrameworkEntry[];
  /** Non-fatal collection issues (e.g. an unreadable manifest). */
  readonly warnings: readonly string[];
}

/**
 * List-length caps applied by the JSON renderer to keep the plugin payload
 * prompt-sized. The lists are naturally small; these bound pathological repos.
 */
export const STACK_LIMITS = {
  languages: 40,
  ecosystems: 40,
  tooling: 60,
  frameworks: 60,
  manifestsPerEcosystem: 12,
  evidencePerTool: 12,
} as const;
