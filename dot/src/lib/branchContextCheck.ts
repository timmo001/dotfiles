import { readdirSync, existsSync, readFileSync } from "fs";
import { join, relative } from "path";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

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

/** Result of a branch-context registration scan. */
export interface BranchContextCheckResult {
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
// Markdown Scanning
// ---------------------------------------------------------------------------

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
// BranchContextPlugin Registration Scanning
// ---------------------------------------------------------------------------

const BRANCH_CONTEXT_PLUGIN_PATH =
  "agents/.config/opencode/plugins/branch-context.ts";

const COMMAND_SCAN_PATHS = [
  "agents/.config/opencode/commands",
  ".opencode/commands",
] as const;

const BRANCH_CONTEXT_RE =
  /BranchContextPlugin|work-scope mode|full-context mode/i;

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

/** Check branch-context consumers against plugin registrations. */
export function checkBranchContext(
  publicDotfiles: string,
  privateDotfiles?: string | null,
): BranchContextCheckResult {
  const branchContextConsumers = scanBranchContextConsumers(
    publicDotfiles,
    privateDotfiles,
  );
  const branchContextRegistrations =
    scanBranchContextRegistrations(publicDotfiles);

  const branchContextIssues = checkBranchContextRegistrations(
    branchContextConsumers,
    branchContextRegistrations,
  );

  return {
    branchContextConsumers,
    branchContextIssues,
  };
}
