/**
 * @file The shared stack-context producer.
 *
 * `detectStack` walks the target directory once and returns a single
 * {@link StackContextData} snapshot. It reads only manifests and takes an
 * extension/filename census for languages: it never reads source file bodies,
 * runs a subprocess, or resolves a dependency closure, which is why it stays
 * sub-25ms even on large repositories (Phase 0 benchmark). Both the text
 * renderer (`dot stack-context`) and the JSON renderer (the OpenCode
 * stack-context plugin) format this one snapshot, so they cannot drift.
 */
import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { extname, join } from "node:path";
import {
  EXT_LANG,
  FILENAME_LANG,
  FRAMEWORK_INDEX,
  IGNORE_DIRS,
  MANIFEST_ECO,
  TEXT_SCANNED_ECOSYSTEMS,
} from "./catalog.js";
import {
  type EcosystemEntry,
  type FrameworkEntry,
  type LanguageEntry,
  type StackContextData,
  type StackContextOptions,
} from "./model.js";

/** GitHub Actions ecosystem name and the workflow path fragment that marks it. */
const GITHUB_ACTIONS_ECO = "github-actions";
const WORKFLOWS_FRAGMENT = ".github/workflows/";

/** Mutable accumulator threaded through the directory walk. */
interface WalkAccumulator {
  readonly langFiles: Map<string, number>;
  readonly langDirs: Map<string, Map<string, number>>;
  readonly manifests: Map<string, string[]>;
  scannedFiles: number;
  truncated: boolean;
}

/** Increment a key in a count map. */
function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Take the top `n` keys of a count map, highest count first then by name. */
function topKeys(counts: Map<string, number>, n: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([key]) => key);
}

/** Reduce a repository-relative file path to its top 2 leading directories. */
function locationOf(relPath: string): string {
  const parts = relPath.split("/");
  parts.pop();
  if (parts.length === 0) return ".";
  return parts.slice(0, 2).join("/");
}

/** Read a directory, returning an empty list when it cannot be read. */
function readDir(dir: string): Dirent<string>[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Attribute a single file to a language and record its location. */
function censusFile(acc: WalkAccumulator, name: string, rel: string): void {
  const language = FILENAME_LANG[name] ?? EXT_LANG[extname(name).toLowerCase()];
  if (!language) return;
  bump(acc.langFiles, language);
  const dirs = acc.langDirs.get(language) ?? new Map<string, number>();
  bump(dirs, locationOf(rel));
  acc.langDirs.set(language, dirs);
}

/** Record a manifest path under its ecosystem. */
function recordManifest(acc: WalkAccumulator, eco: string, rel: string): void {
  const list = acc.manifests.get(eco) ?? [];
  list.push(rel);
  acc.manifests.set(eco, list);
}

/** Classify a single file: manifest, GitHub Actions workflow, and/or language. */
function classifyFile(acc: WalkAccumulator, name: string, rel: string): void {
  const eco = MANIFEST_ECO[name];
  if (eco) recordManifest(acc, eco, rel);

  const ext = extname(name).toLowerCase();
  if ((ext === ".yml" || ext === ".yaml") && rel.includes(WORKFLOWS_FRAGMENT)) {
    recordManifest(acc, GITHUB_ACTIONS_ECO, rel);
  }

  censusFile(acc, name, rel);
}

/**
 * Walk the tree once (depth- and file-capped), censusing extensions/filenames
 * and collecting manifest paths. Directory reads that fail are skipped.
 */
function walk(root: string, options: StackContextOptions): WalkAccumulator {
  const acc: WalkAccumulator = {
    langFiles: new Map(),
    langDirs: new Map(),
    manifests: new Map(),
    scannedFiles: 0,
    truncated: false,
  };
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];

  while (stack.length > 0) {
    const { dir, depth } = stack.pop() as { dir: string; depth: number };
    for (const entry of readDir(dir)) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && depth < options.maxDepth) {
          stack.push({ dir: join(dir, entry.name), depth: depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;

      acc.scannedFiles += 1;
      if (acc.scannedFiles > options.maxFiles) {
        acc.truncated = true;
        return acc;
      }
      classifyFile(
        acc,
        entry.name,
        join(dir, entry.name).slice(root.length + 1),
      );
    }
  }
  return acc;
}

/** Parse the dependency names declared by a package.json file. */
function npmDependencyNames(text: string): readonly string[] {
  const pkg = JSON.parse(text) as Record<string, unknown>;
  const names = new Set<string>();
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const block = pkg[field];
    if (block && typeof block === "object") {
      for (const key of Object.keys(block as object)) names.add(key);
    }
  }
  return [...names];
}

/** Whether `token` appears as a standalone package token in manifest `text`. */
function manifestMentions(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w/.-])${escaped}([^\\w/.-]|$)`, "m").test(text);
}

/**
 * Match the framework allowlist against declared dependencies. npm is precise
 * (parsed package.json keys, `authoritative`); go/cargo/python are matched by
 * scanning the manifest for the package token (`strong`).
 */
function detectFrameworks(
  root: string,
  manifests: ReadonlyMap<string, string[]>,
  warnings: string[],
): FrameworkEntry[] {
  const found = new Map<string, FrameworkEntry>();

  for (const rel of manifests.get("npm") ?? []) {
    let names: readonly string[];
    try {
      names = npmDependencyNames(readFileSync(join(root, rel), "utf-8"));
    } catch {
      if (warnings.length < 5) warnings.push(`Could not parse ${rel}.`);
      continue;
    }
    for (const dep of names) {
      const rule = FRAMEWORK_INDEX.get(`npm:${dep}`);
      if (rule && !found.has(rule.name)) {
        found.set(rule.name, {
          name: rule.name,
          via: `npm dep: ${dep}`,
          confidence: "authoritative",
        });
      }
    }
  }

  for (const eco of TEXT_SCANNED_ECOSYSTEMS) {
    for (const rel of manifests.get(eco) ?? []) {
      let text: string;
      try {
        text = readFileSync(join(root, rel), "utf-8");
      } catch {
        continue;
      }
      for (const rule of FRAMEWORK_INDEX.values()) {
        if (rule.eco !== eco || found.has(rule.name)) continue;
        if (manifestMentions(text, rule.pkg)) {
          found.set(rule.name, {
            name: rule.name,
            via: `${eco} manifest: ${rule.pkg}`,
            confidence: "strong",
          });
        }
      }
    }
  }

  return [...found.values()];
}

/** Build the language entries, ordered by file count then name. */
function buildLanguages(
  acc: WalkAccumulator,
  topLocations: number,
): LanguageEntry[] {
  return [...acc.langFiles.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, files]) => ({
      name,
      files,
      locations: topKeys(acc.langDirs.get(name) ?? new Map(), topLocations),
      confidence: "heuristic",
    }));
}

/** Build the ecosystem entries, ordered by name. */
function buildEcosystems(acc: WalkAccumulator): EcosystemEntry[] {
  return [...acc.manifests.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, rels]) => ({
      name,
      manifests: [...rels].sort(),
      confidence: "authoritative",
    }));
}

/** Resolve the readable directory name of a scanned root. */
function rootName(root: string): string {
  return root.split("/").filter(Boolean).pop() ?? root;
}

/**
 * Produce the compact stack summary for `options.root`. Pure filesystem work;
 * never throws for an unreadable root or manifest, degrading to warnings and
 * partial results instead.
 */
export function detectStack(options: StackContextOptions): StackContextData {
  const { root } = options;
  const warnings: string[] = [];

  let isDirectory = false;
  try {
    isDirectory = statSync(root).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    return {
      root,
      name: rootName(root),
      scannedFiles: 0,
      truncated: false,
      languages: [],
      ecosystems: [],
      frameworks: [],
      warnings: [`'${root}' is not a readable directory.`],
    };
  }

  const acc = walk(root, options);
  if (acc.truncated) {
    warnings.push(
      `Scan stopped at the ${options.maxFiles}-file cap; results are partial.`,
    );
  }

  return {
    root,
    name: rootName(root),
    scannedFiles: acc.scannedFiles,
    truncated: acc.truncated,
    languages: buildLanguages(acc, options.topLocations),
    ecosystems: buildEcosystems(acc),
    frameworks: detectFrameworks(root, acc.manifests, warnings),
    warnings,
  };
}
