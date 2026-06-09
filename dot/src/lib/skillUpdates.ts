import { Effect } from "effect";
import { readdirSync, existsSync, readFileSync, mkdirSync } from "fs";
import { writeFileSync, unlinkSync } from "fs";
import { join, basename, dirname, relative } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { GitHub } from "../git/services/GitHub.js";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

/** Parsed origin URL components */
export interface SkillOrigin {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly path: string;
}

/** Parsed SKILL.md frontmatter metadata */
export interface SkillMeta {
  readonly name: string;
  readonly description: string;
  readonly origin: SkillOrigin;
  readonly originUrl: string;
  readonly storedSha: string | null;
  readonly localEdits: readonly string[];
  readonly dir: string;
}

/** A file-level change detected between local and upstream */
export interface FileChange {
  readonly path: string;
  readonly status: "modified" | "removed-upstream" | "added-upstream";
  readonly diffPreview?: string;
}

/** Result of checking a single skill against upstream */
export type CheckResult =
  | {
      readonly type: "up-to-date";
      readonly cached: boolean;
      readonly writeSha?: string;
    }
  | {
      readonly type: "changes";
      readonly files: readonly FileChange[];
      readonly summary: string;
      readonly writeSha: string;
    }
  | {
      readonly type: "local-edits";
      readonly files: readonly FileChange[];
      readonly summary: string;
      readonly writeSha: string;
    }
  | { readonly type: "error"; readonly reason: string }
  | { readonly type: "skipped" };

// ---------------------------------------------------------------------------
// Origin URL Parsing
// ---------------------------------------------------------------------------

const GITHUB_TREE_RE =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/;

/** Parse a GitHub tree URL into its components */
export function parseOrigin(url: string): SkillOrigin | null {
  const match = url.match(GITHUB_TREE_RE);
  if (!match) return null;
  return {
    owner: match[1]!,
    repo: match[2]!,
    branch: match[3]!,
    path: match[4]!,
  };
}

// ---------------------------------------------------------------------------
// Frontmatter Parsing
// ---------------------------------------------------------------------------

/** Extract a frontmatter field value from content (between --- fences) */
function extractFrontmatterField(
  content: string,
  field: string,
): string | null {
  const lines = content.split("\n");
  if (lines[0] !== "---") return null;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") break;
    const line = lines[i]!;
    const prefix = `${field} `;
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

/** Extract the local-edits list from frontmatter */
function extractLocalEdits(content: string): readonly string[] {
  const lines = content.split("\n");
  if (lines[0] !== "---") return [];

  const edits: string[] = [];
  let inEdits = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "---") break;

    if (line === "# local-edits:") {
      inEdits = true;
      continue;
    }
    if (inEdits) {
      if (line.startsWith("#   - ")) {
        edits.push(line.slice(6));
      } else {
        break;
      }
    }
  }
  return edits;
}

/** Parse a SKILL.md file into SkillMeta (returns null if no origin) */
export function parseSkillMeta(
  content: string,
  skillDir: string,
): SkillMeta | null {
  const originUrl = extractFrontmatterField(content, "# origin:");
  if (!originUrl) return null;

  const origin = parseOrigin(originUrl);
  if (!origin) return null;

  const name = extractFrontmatterField(content, "name:") ?? basename(skillDir);
  const description = extractFrontmatterField(content, "description:") ?? "";
  const storedSha = extractFrontmatterField(content, "# upstream-sha:") ?? null;
  const localEdits = extractLocalEdits(content);

  return {
    name,
    description,
    origin,
    originUrl,
    storedSha,
    localEdits,
    dir: skillDir,
  };
}

// ---------------------------------------------------------------------------
// Normalisation (for content comparison)
// ---------------------------------------------------------------------------

/** Strip local-only frontmatter lines for clean comparison */
export function normaliseLocal(content: string): string {
  return content
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("# origin:") &&
        !line.startsWith("# upstream-sha:") &&
        !line.startsWith("# local-edits:") &&
        !line.startsWith("#   - "),
    )
    .join("\n");
}

/** Strip upstream-only metadata fields from content for clean comparison */
export function normaliseUpstream(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inFrontmatter = false;
  let skipBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line === "---" && !inFrontmatter && i === 0) {
      inFrontmatter = true;
      result.push(line);
      continue;
    }
    if (line === "---" && inFrontmatter) {
      inFrontmatter = false;
      skipBlock = false;
      result.push(line);
      continue;
    }

    if (inFrontmatter) {
      if (line.startsWith("metadata:")) {
        skipBlock = true;
        continue;
      }
      if (line.startsWith("tags:")) {
        skipBlock = true;
        continue;
      }
      if (skipBlock && line.startsWith("  ")) {
        continue;
      }
      if (skipBlock && !line.startsWith("  ")) {
        skipBlock = false;
      }
      if (line.startsWith("category:")) {
        continue;
      }
      result.push(line);
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

// ---------------------------------------------------------------------------
// Frontmatter Application
// ---------------------------------------------------------------------------

/** Apply local frontmatter format to upstream SKILL.md content */
export function applyLocalFrontmatter(
  upstreamContent: string,
  meta: SkillMeta,
  sha: string,
): string {
  const lines = upstreamContent.split("\n");
  const result: string[] = [];

  // Find the end of upstream frontmatter
  let fmEnd = -1;
  if (lines[0] === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") {
        fmEnd = i;
        break;
      }
    }
  }

  // Build local frontmatter
  result.push("---");
  result.push(`name: ${meta.name}`);
  result.push(`description: ${meta.description}`);
  result.push(`# origin: ${meta.originUrl}`);
  if (sha) {
    result.push(`# upstream-sha: ${sha}`);
  }
  if (meta.localEdits.length > 0) {
    result.push("# local-edits:");
    for (const edit of meta.localEdits) {
      result.push(`#   - ${edit}`);
    }
  }
  result.push("---");

  // Append body (everything after upstream frontmatter end)
  if (fmEnd >= 0) {
    for (let i = fmEnd + 1; i < lines.length; i++) {
      result.push(lines[i]!);
    }
  } else {
    // No frontmatter in upstream — use all content as body
    result.push(...lines);
  }

  return result.join("\n");
}

/** Write or update the upstream-sha in an existing SKILL.md */
export function writeSha(skillMdPath: string, sha: string): void {
  const content = readFileSync(skillMdPath, "utf-8");
  let updated: string;

  if (content.includes("# upstream-sha:")) {
    updated = content.replace(/^# upstream-sha:.*$/m, `# upstream-sha: ${sha}`);
  } else {
    // Insert after # origin: line
    updated = content.replace(/^(# origin:.*)$/m, `$1\n# upstream-sha: ${sha}`);
  }

  writeFileSync(skillMdPath, updated);
}

// ---------------------------------------------------------------------------
// GitHub API Helpers (via gh CLI)
// ---------------------------------------------------------------------------

/** Run `gh api` through the shared GitHub service. */
export const ghApi = (endpoint: string, jqFilter?: string) =>
  Effect.gen(function* () {
    const github = yield* GitHub;
    return yield* github.api(endpoint, { jq: jqFilter });
  });

/** Get the latest commit SHA touching a path in a GitHub repo */
export const getUpstreamSha = (origin: SkillOrigin) =>
  Effect.gen(function* () {
    const endpoint = `repos/${origin.owner}/${origin.repo}/commits?path=${origin.path}&per_page=1&sha=${origin.branch}`;
    const sha = yield* ghApi(endpoint, ".[0].sha").pipe(
      Effect.catch(() => Effect.succeed("")),
    );

    // Validate: 40 hex chars
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
    return "";
  });

/** Fetch a file's content from GitHub (base64 decoded) */
export const fetchFile = (origin: SkillOrigin, filePath: string) =>
  Effect.gen(function* () {
    const endpoint = `repos/${origin.owner}/${origin.repo}/contents/${origin.path}/${filePath}?ref=${origin.branch}`;
    const base64Content = yield* ghApi(endpoint, ".content");

    if (!base64Content) {
      return yield* Effect.fail(
        new Error(`Empty content returned from gh api ${endpoint}`),
      );
    }

    // Decode base64 (GitHub returns content with newlines embedded)
    const cleaned = base64Content.replace(/\n/g, "");
    return Buffer.from(cleaned, "base64").toString("utf-8");
  });

/** List files in an upstream directory (one level, returns type+name pairs) */
const listUpstreamDir = (origin: SkillOrigin, dirPath: string) =>
  Effect.gen(function* () {
    const endpoint = `repos/${origin.owner}/${origin.repo}/contents/${dirPath}?ref=${origin.branch}`;
    const output = yield* ghApi(endpoint, '.[] | "\\(.type) \\(.name)"').pipe(
      Effect.catch(() => Effect.succeed("")),
    );
    if (!output) return [];

    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const spaceIdx = line.indexOf(" ");
        return {
          type: line.slice(0, spaceIdx) as "file" | "dir",
          name: line.slice(spaceIdx + 1),
        };
      });
  });

/** Recursively list all files in an upstream skill directory */
export const listUpstreamFiles = (origin: SkillOrigin) =>
  Effect.gen(function* () {
    const files: string[] = [];

    const walk = (
      upstreamDir: string,
      relativeDir: string,
    ): Effect.Effect<void, never, GitHub> =>
      Effect.gen(function* () {
        const entries = yield* listUpstreamDir(origin, upstreamDir);

        for (const entry of entries) {
          const relativePath = relativeDir
            ? `${relativeDir}/${entry.name}`
            : entry.name;

          if (entry.type === "file") {
            files.push(relativePath);
          } else if (entry.type === "dir") {
            yield* walk(`${upstreamDir}/${entry.name}`, relativePath);
          }
        }
      });

    yield* walk(origin.path, "");
    return files.sort();
  });

/** Read local skill file content when present. */
function readLocalSkillFile(skillDir: string, file: string): string | null {
  const localPath = join(skillDir, file);
  if (!existsSync(localPath)) return null;
  return readFileSync(localPath, "utf-8");
}

/** Normalise a skill file pair for comparison. */
function normaliseSkillPair(
  file: string,
  localContent: string,
  upstreamContent: string,
): readonly [string, string] {
  if (file === "SKILL.md") {
    return [normaliseLocal(localContent), normaliseUpstream(upstreamContent)];
  }
  return [localContent, upstreamContent];
}

// ---------------------------------------------------------------------------
// Local File Listing
// ---------------------------------------------------------------------------

/** Recursively list all files in a local skill directory (relative paths) */
export function listLocalFiles(skillDir: string): readonly string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(relative(skillDir, fullPath));
      }
    }
  }

  walk(skillDir);
  return files.sort();
}

// ---------------------------------------------------------------------------
// Diff Generation
// ---------------------------------------------------------------------------

const SKILL_DIFF_TMP_DIR = "/tmp/opencode";

/** Remove temporary skill-diff files, ignoring missing-file errors. */
function removeSkillDiffTmp(...paths: readonly string[]): void {
  for (const path of paths) {
    try {
      unlinkSync(path);
    } catch {
      // Already gone — fine
    }
  }
}

/**
 * Remove leftover `skill-diff-*` temp files from the shared tmp dir.
 *
 * Only targets files this module creates; the directory itself is shared with
 * OpenCode and is never removed.
 */
export function cleanupSkillDiffCache(): void {
  if (!existsSync(SKILL_DIFF_TMP_DIR)) return;
  for (const name of readdirSync(SKILL_DIFF_TMP_DIR)) {
    if (name.startsWith("skill-diff-")) {
      removeSkillDiffTmp(join(SKILL_DIFF_TMP_DIR, name));
    }
  }
}

/** Generate a unified diff between two strings (uses external diff command) */
export const generateDiff = (
  localContent: string,
  upstreamContent: string,
  maxLines?: number,
) =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    // Write to temp files for diff
    mkdirSync(SKILL_DIFF_TMP_DIR, { recursive: true });
    const tmpLocal = join(SKILL_DIFF_TMP_DIR, `skill-diff-local-${Date.now()}`);
    const tmpUpstream = join(
      SKILL_DIFF_TMP_DIR,
      `skill-diff-upstream-${Date.now()}`,
    );

    writeFileSync(tmpLocal, localContent + "\n");
    writeFileSync(tmpUpstream, upstreamContent + "\n");

    const produce = Effect.gen(function* () {
      const exitCode = yield* executor.exitCode("diff", [
        "--unified=2",
        tmpLocal,
        tmpUpstream,
      ]);

      if (exitCode === 0) {
        // Files are identical
        return "";
      }

      // exitCode 1 means differences found — read output
      const result = yield* executor
        .run("diff", ["--unified=2", tmpLocal, tmpUpstream])
        .pipe(Effect.catch(() => Effect.succeed("")));

      // Strip header lines and optionally truncate
      const lines = result.split("\n").slice(2);
      const truncated = maxLines ? lines.slice(0, maxLines) : lines;
      return truncated.join("\n");
    });

    return yield* produce.pipe(
      Effect.ensuring(
        Effect.sync(() => removeSkillDiffTmp(tmpLocal, tmpUpstream)),
      ),
    );
  });

/** Generate a full unified diff for display (with labels) */
export const generateFullDiff = (
  localContent: string,
  upstreamContent: string,
  localLabel: string,
  upstreamLabel: string,
) =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    mkdirSync(SKILL_DIFF_TMP_DIR, { recursive: true });
    const tmpLocal = join(SKILL_DIFF_TMP_DIR, `skill-diff-local-${Date.now()}`);
    const tmpUpstream = join(
      SKILL_DIFF_TMP_DIR,
      `skill-diff-upstream-${Date.now()}`,
    );

    writeFileSync(tmpLocal, localContent + "\n");
    writeFileSync(tmpUpstream, upstreamContent + "\n");

    return yield* executor
      .run("diff", [
        "--unified=5",
        `--label=${localLabel}`,
        `--label=${upstreamLabel}`,
        tmpLocal,
        tmpUpstream,
      ])
      .pipe(
        Effect.catch(() => Effect.succeed("")),
        Effect.ensuring(
          Effect.sync(() => removeSkillDiffTmp(tmpLocal, tmpUpstream)),
        ),
      );
  });

// ---------------------------------------------------------------------------
// Core Skill Check Logic
// ---------------------------------------------------------------------------

/** Check a single skill for upstream changes */
export const checkSkill = (meta: SkillMeta) =>
  Effect.gen(function* () {
    const { origin, storedSha, dir } = meta;
    const skillMdPath = join(dir, "SKILL.md");

    // Query upstream SHA
    const upstreamSha = yield* getUpstreamSha(origin);
    const shaQueryFailed = !upstreamSha;

    // SHA to write back: prefer fresh upstream, fall back to stored
    const writeSha = upstreamSha || storedSha || "";

    // Compare against stored SHA (fast path: cached match)
    if (upstreamSha && upstreamSha === storedSha) {
      return { type: "up-to-date", cached: true } as CheckResult;
    }

    // Compare all local and upstream files, including references/**.
    const localFiles = listLocalFiles(dir);
    const upstreamFiles = yield* listUpstreamFiles(origin);
    const allFiles = Array.from(
      new Set([...localFiles, ...upstreamFiles]),
    ).sort();
    const changes: FileChange[] = [];

    for (const file of allFiles) {
      const localContent = readLocalSkillFile(dir, file);

      const upstreamContent = yield* fetchFile(origin, file).pipe(
        Effect.catch(() => Effect.succeed("")),
      );

      if (localContent === null) {
        if (upstreamContent) {
          const diffPreview = yield* generateDiff("", upstreamContent, 20);
          changes.push({ path: file, status: "added-upstream", diffPreview });
        }
        continue;
      }

      if (!upstreamContent) {
        changes.push({ path: file, status: "removed-upstream" });
        continue;
      }

      const [localNorm, upstreamNorm] = normaliseSkillPair(
        file,
        localContent,
        upstreamContent,
      );

      if (localNorm !== upstreamNorm) {
        const diffPreview = yield* generateDiff(localNorm, upstreamNorm, 20);
        changes.push({ path: file, status: "modified", diffPreview });
      }
    }

    if (changes.length === 0) {
      // No content changes despite SHA mismatch — write SHA and report up-to-date
      return { type: "up-to-date", cached: false, writeSha } as CheckResult;
    }

    // Build summary
    const summary = changes
      .map((c) => {
        switch (c.status) {
          case "removed-upstream":
            return `    - ${c.path} (removed upstream)`;
          case "added-upstream":
            return `    + ${c.path} (new upstream)`;
          case "modified":
            return `    ~ ${c.path}`;
        }
      })
      .join("\n");

    // Determine result type based on local edits
    if (meta.localEdits.length > 0) {
      return {
        type: "local-edits",
        files: changes,
        summary,
        writeSha,
      } as CheckResult;
    }

    return {
      type: "changes",
      files: changes,
      summary,
      writeSha,
    } as CheckResult;
  });

// ---------------------------------------------------------------------------
// Apply Updates
// ---------------------------------------------------------------------------

/** Apply upstream changes to a skill (fetches and writes all upstream files) */
export const applySkillUpdate = (meta: SkillMeta, writeSha: string) =>
  Effect.gen(function* () {
    const { origin, dir } = meta;

    // List upstream files for full import
    const upstreamFiles = yield* listUpstreamFiles(origin);
    if (upstreamFiles.length === 0) {
      return false;
    }

    for (const file of upstreamFiles) {
      const upstreamContent = yield* fetchFile(origin, file).pipe(
        Effect.catch(() => Effect.succeed("")),
      );
      if (!upstreamContent) continue;

      const localPath = join(dir, file);
      mkdirSync(dirname(localPath), { recursive: true });

      if (file === "SKILL.md") {
        const rebuilt = applyLocalFrontmatter(upstreamContent, meta, writeSha);
        writeFileSync(localPath, rebuilt);
      } else {
        writeFileSync(localPath, upstreamContent);
      }
    }

    // Also write SHA directly in case the apply rebuilt it differently
    writeSha && writeShaToFile(join(dir, "SKILL.md"), writeSha);
    return true;
  });

/** Write SHA (wrapper that catches if file doesn't exist) */
function writeShaToFile(path: string, sha: string): void {
  try {
    writeSha(path, sha);
  } catch {
    // Silently skip if file not accessible
  }
}

// ---------------------------------------------------------------------------
// Diff Report Building (for OpenCode sessions)
// ---------------------------------------------------------------------------

/** Build the diff content for a single skill (for OpenCode prompt) */
export const buildSingleDiff = (meta: SkillMeta) =>
  Effect.gen(function* () {
    const { origin, dir, name, originUrl, localEdits } = meta;
    const parts: string[] = [];

    parts.push(`## ${name}\n`);
    parts.push(`- **Origin:** ${originUrl}`);
    parts.push(`- **Local path:** ${dir}\n`);

    if (localEdits.length > 0) {
      parts.push("**Local edits noted in frontmatter:**");
      for (const edit of localEdits) {
        parts.push(`- ${edit}`);
      }
      parts.push("");
    }

    const localFiles = listLocalFiles(dir);
    const upstreamFiles = yield* listUpstreamFiles(origin);
    const allFiles = Array.from(
      new Set([...localFiles, ...upstreamFiles]),
    ).sort();
    let hasDiff = false;

    for (const file of allFiles) {
      const localContent = readLocalSkillFile(dir, file);

      const upstreamContent = yield* fetchFile(origin, file).pipe(
        Effect.catch(() => Effect.succeed("")),
      );

      if (localContent === null) {
        if (upstreamContent) {
          const diff = yield* generateFullDiff(
            "",
            upstreamContent,
            `local/${file}`,
            `upstream/${file}`,
          );
          if (diff) {
            parts.push(`### ${file} (new upstream)\n`);
            parts.push("```diff");
            parts.push(diff);
            parts.push("```\n");
            hasDiff = true;
          }
        }
        continue;
      }

      if (!upstreamContent) {
        parts.push(`### ${file} (removed upstream)\n`);
        hasDiff = true;
        continue;
      }

      const [localNorm, upstreamNorm] = normaliseSkillPair(
        file,
        localContent,
        upstreamContent,
      );

      if (localNorm !== upstreamNorm) {
        const diff = yield* generateFullDiff(
          localNorm,
          upstreamNorm,
          `local/${file}`,
          `upstream/${file}`,
        );
        if (diff) {
          parts.push(`### ${file}\n`);
          parts.push("```diff");
          parts.push(diff);
          parts.push("```\n");
          hasDiff = true;
        }
      }
    }

    return hasDiff ? parts.join("\n") : "";
  });

// ---------------------------------------------------------------------------
// Scan Skills Directory
// ---------------------------------------------------------------------------

/** Scan the skills directory and return metadata for all skills with origins */
export function scanSkills(skillsDir: string): readonly SkillMeta[] {
  if (!existsSync(skillsDir)) return [];

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  const skills: SkillMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(skillsDir, entry.name);
    const skillMdPath = join(skillDir, "SKILL.md");

    if (!existsSync(skillMdPath)) continue;

    const content = readFileSync(skillMdPath, "utf-8");
    const meta = parseSkillMeta(content, skillDir);
    if (meta) {
      skills.push(meta);
    }
  }

  return skills;
}
