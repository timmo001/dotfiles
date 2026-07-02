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

/** Branch context injection mode requested by a command */
export type BranchContextMode = "full-context" | "work-scope";

/** A command that asks for BranchContextPlugin context */
export interface BranchContextConsumer {
  /** OpenCode command name, derived from the command file path */
  readonly command: string;
  /** Relative path to the command file */
  readonly file: string;
  /** 1-based line number where the branch-context flow is referenced */
  readonly line: number;
  /** Requested context mode when the command states one explicitly */
  readonly mode: BranchContextMode | "unknown";
}

/** Branch-context command/plugin registration mismatch */
export interface BranchContextIssue extends BranchContextConsumer {
  /** Human-readable explanation of the mismatch */
  readonly reason: string;
  /** Plugin registration mode, when the command is registered in either set */
  readonly registeredMode?: BranchContextMode;
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
  /** Commands that request BranchContextPlugin context */
  readonly branchContextConsumers: readonly BranchContextConsumer[];
  /** Branch-context commands missing from or mismatched with the plugin */
  readonly branchContextIssues: readonly BranchContextIssue[];
}

interface MarkdownFile {
  readonly fullPath: string;
  readonly relPath: string;
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
const SKILL_TRAILING_RE = /`([a-z][a-z0-9]*(?:-[a-z0-9]+)*)`\s+skill\b/g;

/**
 * Pattern: "apply/load" verb + optional "the" + backtick-quoted name.
 * "apply" and "load" are strong skill indicators; "use" is too generic.
 */
const SKILL_APPLY_RE =
  /(?:apply|load)\s+(?:the\s+)?`([a-z][a-z0-9]*(?:-[a-z0-9]+)*)`/g;

/**
 * Pattern: "use the `name` skill" — requires trailing "skill" to avoid
 * matching tool/plugin references like "use the `task` tool".
 */
const SKILL_USE_RE =
  /use\s+(?:the\s+)?`([a-z][a-z0-9]*(?:-[a-z0-9]+)*)`\s+skill\b/g;

/**
 * Pattern: explicit skill loading in commands (Load the `name` skill).
 */
const SKILL_LOAD_RE =
  /[Ll]oad\s+(?:the\s+)?`([a-z][a-z0-9]*(?:-[a-z0-9]+)*)`\s+skill\b/g;

/** Pattern: any backtick-quoted complete skill-like name on a line about skills. */
const BACKTICK_NAME_RE = /`([a-z][a-z0-9]*(?:-[a-z0-9]+)*)`/g;

/** Pattern: a line that is explicitly about applying, loading, or using skills. */
const SKILL_CONTEXT_RE =
  /\b(?:apply|load|use)\b.*\bskills?\b|\bskills?\b.*\b(?:apply|load|use)\b/i;

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
  "skill",
  "pkill",
  "killall",
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

    if (SKILL_CONTEXT_RE.test(line)) {
      BACKTICK_NAME_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = BACKTICK_NAME_RE.exec(line)) !== null) {
        addRef(m[1]);
      }
    }

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

/** Recursively scan Markdown files beneath a root directory */
function scanMarkdownFiles(
  dir: string,
  relBase: string,
): readonly MarkdownFile[] {
  if (!existsSync(dir)) return [];

  const files: MarkdownFile[] = [];
  const scan = (current: string) => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push({ fullPath, relPath: relative(relBase, fullPath) });
      }
    }
  };

  try {
    scan(dir);
  } catch {
    return files;
  }

  return files;
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

/** Private dotfiles paths to scan for skill references. */
const PRIVATE_SCAN_PATHS = [
  "agents/.config/opencode/AGENTS.md",
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

  const scanPath = (dotfilesRoot: string, path: string, relPrefix = "") => {
    const fullPath = join(dotfilesRoot, path);
    if (!existsSync(fullPath)) return;

    if (fullPath.endsWith(".md")) {
      // Direct file
      const content = readFileSync(fullPath, "utf-8");
      const relPath = `${relPrefix}${relative(dotfilesRoot, fullPath)}`;
      refs.push(...extractReferences(content, relPath));
    } else if (existsSync(fullPath)) {
      // Directory — scan .md files within
      for (const file of scanMarkdownFiles(fullPath, dotfilesRoot)) {
        const content = readFileSync(file.fullPath, "utf-8");
        refs.push(...extractReferences(content, `${relPrefix}${file.relPath}`));
      }
    }
  };

  for (const path of SCAN_PATHS) {
    scanPath(publicDotfiles, path);
  }

  if (privateDotfiles) {
    for (const path of PRIVATE_SCAN_PATHS) {
      scanPath(privateDotfiles, path, "~private/");
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// BranchContextPlugin Registration Scanning
// ---------------------------------------------------------------------------

const BRANCH_CONTEXT_PLUGIN_PATH =
  "agents/.config/opencode/plugins/branch-context.ts";

const COMMAND_SCAN_PATHS = [
  "agents/.config/opencode/commands",
  ".opencode/commands",
] as const;

const BRANCH_CONTEXT_RE =
  /branch-context-consumer|BranchContextPlugin|work-scope mode|full-context mode/i;

const WORK_SCOPE_RE = /work-scope mode/i;
const FULL_CONTEXT_RE = /full-context mode/i;
const COMMAND_SET_RE =
  /const\s+(BRANCH_CONTEXT_COMMANDS|WORK_SCOPE_COMMANDS)\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/g;
const STRING_LITERAL_RE = /["']([^"']+)["']/g;

/** Derive the OpenCode command name from a command Markdown file path */
function commandNameFromPath(filePath: string, commandDir: string): string {
  return relative(commandDir, filePath)
    .replace(/\\/g, "/")
    .replace(/\.md$/, "");
}

/** Detect whether a command requests branch-context injection */
function extractBranchContextConsumer(
  command: string,
  file: string,
  content: string,
): BranchContextConsumer | null {
  const lines = content.split("\n");
  const markerIndex = lines.findIndex((line) => BRANCH_CONTEXT_RE.test(line));
  if (markerIndex === -1) return null;

  const mode = lines.some((line) => WORK_SCOPE_RE.test(line))
    ? "work-scope"
    : lines.some((line) => FULL_CONTEXT_RE.test(line))
      ? "full-context"
      : "unknown";

  return { command, file, line: markerIndex + 1, mode };
}

/** Find command files that request BranchContextPlugin injection */
export function scanBranchContextConsumers(
  publicDotfiles: string,
  privateDotfiles?: string | null,
): readonly BranchContextConsumer[] {
  const consumers: BranchContextConsumer[] = [];

  const scanRoot = (dotfilesRoot: string, scanPath: string, relPrefix = "") => {
    const commandDir = join(dotfilesRoot, scanPath);
    for (const file of scanMarkdownFiles(commandDir, dotfilesRoot)) {
      const content = readFileSync(file.fullPath, "utf-8");
      const consumer = extractBranchContextConsumer(
        commandNameFromPath(file.fullPath, commandDir),
        `${relPrefix}${file.relPath}`,
        content,
      );
      if (consumer) consumers.push(consumer);
    }
  };

  for (const scanPath of COMMAND_SCAN_PATHS) {
    scanRoot(publicDotfiles, scanPath);
  }

  if (privateDotfiles) {
    scanRoot(privateDotfiles, "agents/.config/opencode/commands", "~private/");
  }

  return consumers;
}

/** Read BranchContextPlugin command registrations by requested mode */
function scanBranchContextRegistrations(
  publicDotfiles: string,
): ReadonlyMap<string, BranchContextMode> {
  const pluginPath = join(publicDotfiles, BRANCH_CONTEXT_PLUGIN_PATH);
  const registrations = new Map<string, BranchContextMode>();
  if (!existsSync(pluginPath)) return registrations;

  const content = readFileSync(pluginPath, "utf-8");
  let setMatch: RegExpExecArray | null;
  COMMAND_SET_RE.lastIndex = 0;
  while ((setMatch = COMMAND_SET_RE.exec(content)) !== null) {
    const mode: BranchContextMode =
      setMatch[1] === "BRANCH_CONTEXT_COMMANDS" ? "full-context" : "work-scope";
    STRING_LITERAL_RE.lastIndex = 0;
    let commandMatch: RegExpExecArray | null;
    while ((commandMatch = STRING_LITERAL_RE.exec(setMatch[2])) !== null) {
      registrations.set(commandMatch[1], mode);
    }
  }

  return registrations;
}

/** Compare branch-context command consumers with plugin registrations */
function checkBranchContextRegistrations(
  consumers: readonly BranchContextConsumer[],
  registrations: ReadonlyMap<string, BranchContextMode>,
): readonly BranchContextIssue[] {
  return consumers.flatMap((consumer) => {
    const registeredMode = registrations.get(consumer.command);
    if (!registeredMode) {
      return [
        {
          ...consumer,
          reason: "not registered in BranchContextPlugin command sets",
        },
      ];
    }

    if (consumer.mode !== "unknown" && consumer.mode !== registeredMode) {
      return [
        {
          ...consumer,
          registeredMode,
          reason: `uses ${consumer.mode} mode but is registered as ${registeredMode}`,
        },
      ];
    }

    return [];
  });
}

// ---------------------------------------------------------------------------
// Check Orchestration
// ---------------------------------------------------------------------------

/**
 * Skills OpenCode registers in-process rather than from a skill directory.
 * References to these are valid even though they have no `SKILL.md` on disk,
 * so they must not be reported as broken references.
 */
const BUILTIN_SKILL_NAMES = new Set(["customize-opencode"]);

/** Run the full skill-check analysis */
export function checkSkills(
  publicDotfiles: string,
  privateDotfiles?: string | null,
): SkillCheckResult {
  const skills = discoverSkills(publicDotfiles, privateDotfiles);
  const references = scanReferences(publicDotfiles, privateDotfiles);
  const branchContextConsumers = scanBranchContextConsumers(
    publicDotfiles,
    privateDotfiles,
  );
  const branchContextRegistrations =
    scanBranchContextRegistrations(publicDotfiles);

  const validNames = new Set([
    ...skills.map((s) => s.name),
    ...BUILTIN_SKILL_NAMES,
  ]);
  const referencedNames = new Set(references.map((r) => r.name));

  const broken = references.filter((r) => !validNames.has(r.name));
  const unreferenced = skills.filter((s) => !referencedNames.has(s.name));
  const branchContextIssues = checkBranchContextRegistrations(
    branchContextConsumers,
    branchContextRegistrations,
  );

  return {
    skills,
    references,
    broken,
    unreferenced,
    branchContextConsumers,
    branchContextIssues,
  };
}
