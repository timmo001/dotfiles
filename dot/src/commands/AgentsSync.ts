import { Effect } from "effect";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog, type OutputLogService } from "../services/OutputLog.js";

const HOME = process.env.HOME ?? "/home/" + process.env.USER;

/** Metadata attached to each sync operation */
interface SyncMetadata {
  readonly source: string;
  readonly timestamp: string;
}

/** Adapter for a single harness target that receives mirrored AGENTS.md content */
interface HarnessTarget {
  readonly name: string;
  readonly outputPath: () => string;
  readonly transform: (content: string, metadata: SyncMetadata) => string;
}

/** Replace $HOME prefix with ~ for display */
function displayPath(p: string): string {
  return p.replace(HOME, "~");
}

/** Atomic write: mkdir -p, write to temp, rename over destination */
function atomicWrite(dest: string, content: string): void {
  const dir = dirname(dest);
  mkdirSync(dir, { recursive: true });

  // Remove broken symlinks at dest (rename won't overwrite them on all platforms)
  try {
    const stat = existsSync(dest);
    if (!stat) {
      // lstatSync would tell us if it's a dangling symlink, but
      // the simplest approach: unlink if the path entry exists but is unresolvable
      unlinkSync(dest);
    }
  } catch {
    // No existing file or symlink — nothing to remove
  }

  const tmp = `${dest}.tmp.${process.pid}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, dest);
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

const cursorTarget: HarnessTarget = {
  name: "cursor",
  outputPath: () =>
    process.env.DOT_AGENTS_SYNC_RULE_FILE ??
    join(HOME, ".cursor", "rules", "global-agents.mdc"),
  transform: (content, meta) =>
    [
      "---",
      "description: Global agent instructions mirrored from AGENTS.md; refresh with dot agents-sync.",
      "alwaysApply: true",
      "---",
      "",
      `<!-- dot agents-sync: source=${meta.source} synced=${meta.timestamp} -->`,
      "",
      content,
    ].join("\n"),
};

const claudeTarget: HarnessTarget = {
  name: "claude",
  outputPath: () => join(HOME, ".claude", "CLAUDE.md"),
  transform: (content, meta) =>
    [
      `<!-- dot agents-sync: source=${meta.source} synced=${meta.timestamp} -->`,
      "",
      content,
    ].join("\n"),
};

const codexTarget: HarnessTarget = {
  name: "codex",
  outputPath: () => join(HOME, ".codex", "AGENTS.md"),
  transform: (content, meta) =>
    [
      `<!-- dot agents-sync: source=${meta.source} synced=${meta.timestamp} -->`,
      "",
      content,
    ].join("\n"),
};

const targets: readonly HarnessTarget[] = [
  cursorTarget,
  claudeTarget,
  codexTarget,
];

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Mirror `~/.config/opencode/AGENTS.md` to all registered harness targets,
 * and sync skills from `~/.agents/skills/` to Cursor as `.mdc` rules.
 *
 * Each target receives a transformed copy written directly to its native
 * instructions path. OpenCode is the single source of truth; all other
 * tools receive plain file copies (no symlinks).
 *
 * Respects environment overrides:
 * - `DOT_AGENTS_SYNC_SOURCE` — path to source AGENTS.md (default: `~/.config/opencode/AGENTS.md`)
 * - `DOT_AGENTS_SYNC_RULE_FILE` — override Cursor output path
 */
export const agentsSync = Effect.gen(function* () {
  yield* Config;
  const log = yield* OutputLog;

  yield* log.section("Agents Rules Sync");

  const source =
    process.env.DOT_AGENTS_SYNC_SOURCE ??
    join(HOME, ".config", "opencode", "AGENTS.md");

  if (!existsSync(source)) {
    yield* log.warn(`Skipped (missing source): ${displayPath(source)}`);
    return;
  }

  const content = readFileSync(source, "utf-8");
  const metadata: SyncMetadata = {
    source: displayPath(source),
    timestamp: new Date().toISOString(),
  };

  for (const target of targets) {
    const dest = target.outputPath();
    const output = target.transform(content, metadata);

    yield* Effect.sync(() => atomicWrite(dest, output));
    yield* log.info(`${target.name}: ${displayPath(dest)}`);
  }

  // Sync skills to Cursor as .mdc rules (Apply Intelligently mode)
  yield* syncSkillsToCursor(log, metadata);
});

// ---------------------------------------------------------------------------
// Skill Sync — Cursor
// ---------------------------------------------------------------------------

/** Prefix for generated skill rule files in Cursor */
const CURSOR_SKILL_PREFIX = "skill-";

/** Parse YAML frontmatter from a SKILL.md file */
function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { body: content };

  const frontmatter = match[1];
  const body = match[2];

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  // Description can be single-line or multi-line (>)
  let description: string | undefined;
  const descSingleMatch = frontmatter.match(
    /^description:\s*(?!>)(.+)$/m,
  );
  if (descSingleMatch) {
    description = descSingleMatch[1].trim();
  } else {
    // Multi-line folded scalar (description: >\n  ...)
    const descMultiMatch = frontmatter.match(
      /^description:\s*>\s*\n((?:[ \t]+.+\n?)+)/m,
    );
    if (descMultiMatch) {
      description = descMultiMatch[1]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ");
    }
  }

  return {
    name: nameMatch?.[1]?.trim(),
    description,
    body,
  };
}

/** Transform a skill into Cursor .mdc format (Apply Intelligently mode) */
function skillToMdc(
  description: string,
  body: string,
  meta: SyncMetadata,
): string {
  return [
    "---",
    `description: "${description.replace(/"/g, '\\"')}"`,
    "---",
    "",
    `<!-- dot agents-sync: source=~/.agents/skills synced=${meta.timestamp} -->`,
    "",
    body,
  ].join("\n");
}

/**
 * Sync all skills from `~/.agents/skills/` to Cursor as `.mdc` rule files.
 *
 * Each skill becomes `~/.cursor/rules/skill-<name>.mdc` with the skill's
 * description in frontmatter (no globs, no alwaysApply) so Cursor uses
 * "Apply Intelligently" mode — the agent reads descriptions and decides
 * when to pull each rule in.
 */
function syncSkillsToCursor(log: OutputLogService, meta: SyncMetadata) {
  return Effect.gen(function* () {
    const skillsDir = join(HOME, ".agents", "skills");
    const cursorRulesDir = join(HOME, ".cursor", "rules");

    if (!existsSync(skillsDir)) {
      yield* log.info("skills: skipped (no ~/.agents/skills/)");
      return;
    }

    mkdirSync(cursorRulesDir, { recursive: true });

    // Discover existing synced skill files to detect removals
    const existingSkillFiles = new Set(
      readdirSync(cursorRulesDir)
        .filter(
          (f) => f.startsWith(CURSOR_SKILL_PREFIX) && f.endsWith(".mdc"),
        ),
    );

    let synced = 0;
    const entries = readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const skillDir = join(skillsDir, entry.name);
      const skillFile = join(skillDir, "SKILL.md");

      if (!existsSync(skillFile)) continue;

      const content = readFileSync(skillFile, "utf-8");
      const parsed = parseSkillFrontmatter(content);

      if (!parsed.description) continue;

      const outputName = `${CURSOR_SKILL_PREFIX}${parsed.name ?? entry.name}.mdc`;
      const outputPath = join(cursorRulesDir, outputName);
      const mdcContent = skillToMdc(parsed.description, parsed.body, meta);

      atomicWrite(outputPath, mdcContent);
      existingSkillFiles.delete(outputName);
      synced++;
    }

    // Remove stale skill files that no longer have a source
    for (const staleFile of existingSkillFiles) {
      const stalePath = join(cursorRulesDir, staleFile);
      try {
        unlinkSync(stalePath);
      } catch {
        // Ignore removal failures
      }
    }

    yield* log.info(
      `skills: ${synced} skill(s) synced to ${displayPath(cursorRulesDir)}`,
    );

    if (existingSkillFiles.size > 0) {
      yield* log.info(
        `skills: ${existingSkillFiles.size} stale rule(s) removed`,
      );
    }
  });
}
