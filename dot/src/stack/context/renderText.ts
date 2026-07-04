/**
 * @file Text renderer for `dot stack-context`.
 *
 * Formats a {@link StackContextData} snapshot into the human/agent-facing text
 * output: a header, then the languages, ecosystems, and frameworks sections.
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
} from "./model.js";

/** Manifests shown inline per ecosystem before collapsing to a count. */
const MAX_MANIFESTS_SHOWN = 6;

/** Render a language as `Name  N files  · loc, loc`. */
function formatLanguage(language: LanguageEntry): string {
  const noun = language.files === 1 ? "file" : "files";
  const locations = language.locations.length
    ? language.locations.join(", ")
    : "(root)";
  return `${language.name}  ${language.files} ${noun}  · ${locations}`;
}

/** Render an ecosystem's manifest list, collapsing the overflow to a count. */
function formatEcosystem(ecosystem: EcosystemEntry): string {
  const shown = ecosystem.manifests.slice(0, MAX_MANIFESTS_SHOWN);
  const extra = ecosystem.manifests.length - shown.length;
  const suffix = extra > 0 ? ` (+${extra} more)` : "";
  return `${ecosystem.name}: ${shown.join(", ") || "(none)"}${suffix}`;
}

/** Render a framework as `Name  (via)`. */
function formatFramework(framework: FrameworkEntry): string {
  return `${framework.name}  (${framework.via})`;
}

/** Append a titled section, or a `(none detected)` placeholder when empty. */
function appendSection(
  lines: string[],
  styler: Styler,
  title: string,
  rows: readonly string[],
): void {
  lines.push(styler.heading(title));
  if (rows.length === 0) {
    lines.push("  (none detected)");
  } else {
    for (const row of rows) lines.push(`  ${row}`);
  }
  lines.push("");
}

/**
 * Render the stack-context snapshot as `dot stack-context` text output: a
 * header line, the scanned-file count, then the languages, ecosystems, and
 * frameworks sections, plus any warnings and a discoverability hint.
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

  appendSection(
    lines,
    styler,
    "Languages:",
    data.languages.map(formatLanguage),
  );
  appendSection(
    lines,
    styler,
    "Ecosystems:",
    data.ecosystems.map(formatEcosystem),
  );
  appendSection(
    lines,
    styler,
    "Frameworks:",
    data.frameworks.map(formatFramework),
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
