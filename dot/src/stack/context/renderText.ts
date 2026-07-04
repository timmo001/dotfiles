/**
 * @file Text renderer for `dot stack-context`.
 *
 * Formats a {@link StackContextData} snapshot into the human/agent-facing text
 * output: a header, then the languages, ecosystems, tooling, and frameworks
 * sections.
 * Pass a colour-emitting `styler` for interactive terminal output; the default
 * {@link plainStyler} leaves the text unstyled for pipes, captured agent
 * context, and the MCP layer.
 */
import { plainStyler, type Styler } from "../../lib/ansi.js";
import type {
  EcosystemEntry,
  FrameworkEntry,
  LanguageEntry,
  StackContextData,
  ToolingEntry,
  ToolingKind,
} from "./model.js";

/** Manifests shown inline per ecosystem before collapsing to a count. */
const MAX_MANIFESTS_SHOWN = 6;

/** Stable grouping order for tooling in human CLI output. */
const TOOLING_KIND_ORDER: readonly ToolingKind[] = [
  "package manager",
  "task runner",
  "linter",
  "formatter",
  "build tool",
  "test runner",
  "git hook",
  "release tool",
];

/** Compute a rounded percentage, keeping non-zero sections visible. */
function percentage(count: number, total: number): string {
  if (total <= 0) return "0%";
  const value = Math.round((count / total) * 100);
  return `${Math.max(1, value)}%`;
}

/** Render a language as `Name  N files  · loc, loc`. */
function formatLanguage(
  language: LanguageEntry,
  totalLanguageFiles: number,
  styler: Styler,
): string {
  const noun = language.files === 1 ? "file" : "files";
  const locations = language.locations.length
    ? language.locations.join(", ")
    : "(root)";
  return `${styler.label(language.name)}  ${language.files} ${noun} (${percentage(language.files, totalLanguageFiles)})  · ${locations}`;
}

/** Render an ecosystem's manifest list, collapsing the overflow to a count. */
function formatEcosystem(ecosystem: EcosystemEntry, styler: Styler): string {
  const shown = ecosystem.manifests.slice(0, MAX_MANIFESTS_SHOWN);
  const extra = ecosystem.manifests.length - shown.length;
  const suffix = extra > 0 ? ` (+${extra} more)` : "";
  return `${styler.label(`${ecosystem.name}:`)} ${shown.join(", ") || "(none)"}${suffix}`;
}

/** Render a framework as `Name  (via)`. */
function formatFramework(framework: FrameworkEntry, styler: Styler): string {
  return `${styler.label(framework.name)}  ${styler.dim(framework.via)}`;
}

/** Render tooling as `Name  kinds · evidence`. */
function formatTooling(tool: ToolingEntry, styler: Styler): string {
  const evidence = tool.evidence.length
    ? `  · ${styler.dim(tool.evidence.join(", "))}`
    : "";
  return `${styler.label(tool.name)}  ${tool.kinds.join(", ")}${evidence}`;
}

/** Group tooling rows by their first matching kind in the stable display order. */
function groupedToolingRows(
  tools: readonly ToolingEntry[],
  styler: Styler,
): string[] {
  const rows: string[] = [];
  const rendered = new Set<string>();

  for (const kind of TOOLING_KIND_ORDER) {
    const group = tools.filter(
      (tool) => !rendered.has(tool.name) && tool.kinds.includes(kind),
    );
    if (!group.length) continue;
    rows.push(styler.heading(`${kind}:`));
    for (const tool of group) {
      rows.push(`  ${formatTooling(tool, styler)}`);
      rendered.add(tool.name);
    }
  }

  for (const tool of tools) {
    if (rendered.has(tool.name)) continue;
    rows.push(formatTooling(tool, styler));
  }

  return rows;
}

/** Append a titled section, or a `(none detected)` placeholder when empty. */
function appendSection(
  lines: string[],
  styler: Styler,
  title: string,
  count: number,
  rows: readonly string[],
): void {
  lines.push(styler.heading(`${title} (${count}):`));
  if (rows.length === 0) {
    lines.push("  (none detected)");
  } else {
    for (const row of rows) lines.push(`  ${row}`);
  }
  lines.push("");
}

/**
 * Render the stack-context snapshot as `dot stack-context` text output: a
 * header line, the scanned-file count, then the languages, ecosystems,
 * tooling, and frameworks sections, plus any warnings and a discoverability
 * hint.
 */
export function renderStackContextText(
  data: StackContextData,
  styler: Styler = plainStyler,
): string {
  const lines: string[] = [];
  lines.push(`${styler.heading("Stack:")} ${data.name} (${data.root})`);
  lines.push(
    `${data.scannedFiles} files scanned${data.truncated ? " (truncated at cap)" : ""}`,
  );
  lines.push("");

  const totalLanguageFiles = data.languages.reduce(
    (sum, language) => sum + language.files,
    0,
  );

  appendSection(
    lines,
    styler,
    "Languages",
    data.languages.length,
    data.languages.map((language) =>
      formatLanguage(language, totalLanguageFiles, styler),
    ),
  );
  appendSection(
    lines,
    styler,
    "Ecosystems",
    data.ecosystems.length,
    data.ecosystems.map((ecosystem) => formatEcosystem(ecosystem, styler)),
  );
  appendSection(
    lines,
    styler,
    "Tooling",
    data.tooling.length,
    groupedToolingRows(data.tooling, styler),
  );
  appendSection(
    lines,
    styler,
    "Frameworks",
    data.frameworks.length,
    data.frameworks.map((framework) => formatFramework(framework, styler)),
  );

  if (data.warnings.length) {
    for (const warning of data.warnings)
      lines.push(styler.warn(`! ${warning}`));
    lines.push("");
  }

  lines.push(
    styler.markdown(
      "Use --json for the stack-context plugin payload. `dot stack-context --help` lists all flags.",
    ),
  );

  return lines.join("\n") + "\n";
}
