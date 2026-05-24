import { readdirSync, existsSync, readFileSync } from "fs";
import { join, relative } from "path";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

/** A discovered skill directory */
export interface SkillEntry {
  /** Skill name (directory basename) */
  readonly name: string;
  /** Absolute path to the skill directory */
  readonly dir: string;
  /** Whether this is a repo-local skill (.opencode/skills/) vs global */
  readonly local: boolean;
}

/** A reference to a skill found in a scanned file */
export interface SkillReference {
  /** Skill name as referenced */
  readonly name: string;
  /** Relative path to the file containing the reference */
  readonly file: string;
  /** 1-based line number */
  readonly line: number;
}

/** Result of a full skill-check scan */
export interface SkillCheckResult {
  /** All valid skill entries discovered */
  readonly skills: readonly SkillEntry[];
  /** All skill references found in scanned files */
  readonly references: readonly SkillReference[];
  /** References to skill names that don't exist */
  readonly broken: readonly SkillReference[];
  /** Skills that exist but are never referenced */
  readonly unreferenced: readonly SkillEntry[];
}

// ---------------------------------------------------------------------------
// Skill Discovery
// ---------------------------------------------------------------------------

/** Scan a skills directory and return all valid entries */
function scanSkillDir(dir: string, local: boolean): readonly SkillEntry[] {
  if (!existsSync(dir)) return [];
  const entries: SkillEntry[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const skillDir = join(dir, name.name);
    const skillFile = join(skillDir, "SKILL.md");
    if (existsSync(skillFile)) {
      entries.push({ name: name.name, dir: skillDir, local });
    }
  }
  return entries;
}

/** Discover all skills in global, repo-local, and private locations */
export function discoverSkills(
  publicDotfiles: string,
  privateDotfiles?: string | null,
): readonly SkillEntry[] {
  const globalDir = join(publicDotfiles, "agents/.agents/skills");
  const localDir = join(publicDotfiles, ".opencode/skills");
  const skills = [
    ...scanSkillDir(globalDir, false),
    ...scanSkillDir(localDir, true),
  ];
  if (privateDotfiles) {
    const privateDir = join(privateDotfiles, "agents/.agents/skills");
    skills.push(...scanSkillDir(privateDir, false));
  }
  return skills;
}

// ---------------------------------------------------------------------------
// Reference Scanning
// ---------------------------------------------------------------------------

/**
 * Pattern: backtick-quoted name followed by "skill" keyword.
 * Matches: `skill-name` skill, `skill-name` skill when...
 */
const SKILL_TRAILING_RE = /`([a-z][a-z0-9-]*)`\s+skill\b/g;

/**
 * Pattern: "apply/load" verb + optional "the" + backtick-quoted name.
 * "apply" and "load" are strong skill indicators; "use" is too generic.
 */
const SKILL_APPLY_RE = /(?:apply|load)\s+(?:the\s+)?`([a-z][a-z0-9-]*)`/g;

/**
 * Pattern: "use the `name` skill" — requires trailing "skill" to avoid
 * matching tool/plugin references like "use the `task` tool".
 */
const SKILL_USE_RE = /use\s+(?:the\s+)?`([a-z][a-z0-9-]*)`\s+skill\b/g;

/**
 * Pattern: explicit skill loading in commands (Load the `name` skill).
 */
const SKILL_LOAD_RE = /[Ll]oad\s+(?:the\s+)?`([a-z][a-z0-9-]*)`\s+skill\b/g;

/** Common non-skill terms that might match patterns above */
const IGNORE_TERMS = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "main",
  "master",
  "head",
  "git",
  "dot",
  "stow",
  "bun",
  "npm",
  "pnpm",
  "node",
  "task",
  "write",
  "read",
]);

/** Extract skill references from file content */
function extractReferences(
  content: string,
  filePath: string,
): readonly SkillReference[] {
  const refs: SkillReference[] = [];
  const seen = new Set<string>();
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip code blocks
    if (line.trimStart().startsWith("```")) continue;

    const addRef = (name: string) => {
      const key = `${name}:${i + 1}`;
      if (seen.has(key) || IGNORE_TERMS.has(name)) return;
      seen.add(key);
      refs.push({ name, file: filePath, line: i + 1 });
    };

    // Match all patterns
    for (const re of [
      SKILL_TRAILING_RE,
      SKILL_APPLY_RE,
      SKILL_USE_RE,
      SKILL_LOAD_RE,
    ]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        addRef(m[1]);
      }
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// File Scanning
// ---------------------------------------------------------------------------

/** Files to scan for skill references, relative to publicDotfiles */
const SCAN_PATHS = [
  "AGENTS.md",
  "agents/.config/opencode/agents",
  "agents/.config/opencode/commands",
  ".opencode/commands",
];

/** Scan all relevant files and collect skill references */
export function scanReferences(
  publicDotfiles: string,
  privateDotfiles?: string | null,
): readonly SkillReference[] {
  const refs: SkillReference[] = [];

  for (const scanPath of SCAN_PATHS) {
    const fullPath = join(publicDotfiles, scanPath);
    if (!existsSync(fullPath)) continue;

    if (fullPath.endsWith(".md")) {
      // Direct file
      const content = readFileSync(fullPath, "utf-8");
      const relPath = relative(publicDotfiles, fullPath);
      refs.push(...extractReferences(content, relPath));
    } else if (existsSync(fullPath)) {
      // Directory — scan .md files within
      try {
        const entries = readdirSync(fullPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
          const fileFull = join(fullPath, entry.name);
          const content = readFileSync(fileFull, "utf-8");
          const relPath = relative(publicDotfiles, fileFull);
          refs.push(...extractReferences(content, relPath));
        }
      } catch {
        // Directory doesn't exist or isn't readable
      }
    }
  }

  // Also scan the global AGENTS.md from private dotfiles if available
  if (privateDotfiles) {
    const globalAgents = join(
      privateDotfiles,
      "agents/.config/opencode/AGENTS.md",
    );
    if (existsSync(globalAgents)) {
      const content = readFileSync(globalAgents, "utf-8");
      refs.push(
        ...extractReferences(
          content,
          "~private/agents/.config/opencode/AGENTS.md",
        ),
      );
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Check Orchestration
// ---------------------------------------------------------------------------

/** Run the full skill-check analysis */
export function checkSkills(
  publicDotfiles: string,
  privateDotfiles?: string | null,
): SkillCheckResult {
  const skills = discoverSkills(publicDotfiles, privateDotfiles);
  const references = scanReferences(publicDotfiles, privateDotfiles);

  const validNames = new Set(skills.map((s) => s.name));
  const referencedNames = new Set(references.map((r) => r.name));

  const broken = references.filter((r) => !validNames.has(r.name));
  const unreferenced = skills.filter((s) => !referencedNames.has(s.name));

  return { skills, references, broken, unreferenced };
}
