import { formatLocalNoteDateTimeFromEpochSeconds } from "./time.js";

/** Parsed Git repository identity for repo-scoped notes. */
export interface RepoNoteIdentity {
  /** GitHub owner or organisation parsed from the selected remote. */
  readonly owner: string;
  /** GitHub repository name parsed from the selected remote. */
  readonly repo: string;
  /** Remote name used to resolve owner/repo. */
  readonly remote: string;
  /** Raw remote URL used to resolve owner/repo. */
  readonly remoteUrl: string;
}

/** Handoff priority level, highest urgency first when ranked. */
export type NotePriority = "low" | "medium" | "high" | "critical";

/** Grouping dimension applied to the notes list. */
export type NoteGroupMode = "none" | "priority";

/** Group modes cycled by the notes view grouping key, in order. */
export const GROUP_CYCLE: readonly NoteGroupMode[] = ["priority", "none"];

/** Priority levels ordered highest-first for display and selection. */
export const PRIORITY_LEVELS: readonly NotePriority[] = [
  "critical",
  "high",
  "medium",
  "low",
];

/** Priority applied to handoffs that declare none. */
export const DEFAULT_NOTE_PRIORITY: NotePriority = "medium";

/** Frontmatter extracted from a note file. */
export interface NoteFrontmatter {
  /** Display title from frontmatter. */
  readonly name: string | null;
  /** One-line note description from frontmatter. */
  readonly description: string | null;
  /** Kebab-case tags parsed from frontmatter. */
  readonly tags: readonly string[];
  /** Handoff priority parsed from frontmatter, or null when absent/invalid. */
  readonly priority: NotePriority | null;
}

/** Repo note entry with file metadata and parsed frontmatter. */
export interface NoteEntry extends NoteFrontmatter {
  /** Markdown filename, relative to the repo notes directory. */
  readonly filename: string;
  /** Absolute note file path. */
  readonly filePath: string;
  /** Repository section slug (`owner/repo`) when listed across all repos. */
  readonly repoSlug?: string;
  /** Modification time in epoch seconds. */
  readonly mtime: number;
}

/** Notes grouped under one `repo-notes/<owner>/<repo>` directory. */
export interface NoteRepoSection {
  /** Repository slug used as the section heading. */
  readonly repoSlug: string;
  /** Absolute directory path for this repository's notes. */
  readonly notesPath: string;
  /** Note entries in this repository, sorted newest-first. */
  readonly entries: readonly NoteEntry[];
}

/** Options for rendering the OpenCode notes context block. */
export interface NoteContextOptions {
  /** OpenCode command name that requested context. */
  readonly command: string;
}

/** Result of a best-effort git commit after note I/O. */
export interface NoteCommitResult {
  /** Whether the commit step completed or had nothing to commit. */
  readonly ok: boolean;
  /** Command output when available. */
  readonly text?: string;
  /** Non-fatal error message when commit failed. */
  readonly error?: string;
}

/**
 * Outcome of the best-effort push after a note mutation.
 *
 * Surfaced to the interactive session (a repo-notes toast, or the CLI's plain
 * output) rather than folded into the writing agent's tool output.
 */
export interface NotePushResult {
  /** Whether the push completed. */
  readonly ok: boolean;
  /** Human summary of what was pushed, e.g. `Pushed to origin/main`. */
  readonly message: string;
  /** Non-fatal error message when the push did not complete. */
  readonly error?: string;
}

/** Result returned after writing a note file. */
export interface NoteWriteResult {
  /** Absolute path written. */
  readonly path: string;
  /** Markdown output suitable for OpenCode tool display. */
  readonly output: string;
  /** Git commit outcome for the write. */
  readonly commit: NoteCommitResult;
  /** Best-effort push outcome, or undefined when the vault has no remote. */
  readonly push?: NotePushResult;
}

/** Result returned after deleting a note file. */
export interface NoteDeleteResult {
  /** Absolute path deleted. */
  readonly path: string;
  /** Markdown output suitable for OpenCode tool display. */
  readonly output: string;
  /** Git commit outcome for the deletion. */
  readonly commit: NoteCommitResult;
  /** Best-effort push outcome, or undefined when the vault has no remote. */
  readonly push?: NotePushResult;
}

/** Kind of note to create via the add-item flow. */
export type NoteCreateKind = "note" | "handoff";

/** Draft note returned after initial file creation (before editor launch). */
export interface NoteCreateDraft {
  /** The NoteEntry for the newly created draft file. */
  readonly entry: NoteEntry;
  /** The initial seed content written to the file. */
  readonly content: string;
}

/** Supported `dot notes list` output formats. */
export type NotesListFormat = "labels" | "json";

/** Render a note label in the legacy RepoNotesPlugin format. */
export function formatNoteLabel(entry: NoteEntry): string {
  const date = formatLocalNoteDateTimeFromEpochSeconds(entry.mtime);
  const tagPart = entry.tags.length ? ` [tags: ${entry.tags.join(", ")}]` : "";

  if (entry.name && entry.description) {
    return `${entry.filename} — ${entry.name}: ${entry.description}${tagPart} (last modified: ${date})`;
  }

  if (entry.name) {
    return `${entry.filename} — ${entry.name}${tagPart} (last modified: ${date})`;
  }

  return `${entry.filename}${tagPart} (last modified: ${date})`;
}

/** Render repo-grouped note labels with Markdown-style section headings. */
export function formatNoteSections(
  sections: readonly NoteRepoSection[],
): string {
  return sections
    .map((section) =>
      [`## ${section.repoSlug}`, ...section.entries.map(formatNoteLabel)].join(
        "\n",
      ),
    )
    .join("\n\n");
}

/** Parse a frontmatter priority value, returning null when unrecognised. */
export function parseNotePriority(value: string): NotePriority | null {
  const normalised = value
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
  return PRIORITY_LEVELS.includes(normalised as NotePriority)
    ? (normalised as NotePriority)
    : null;
}

/** Resolve an entry's effective priority, defaulting absent values to medium. */
export function notePriority(entry: NoteEntry): NotePriority {
  return entry.priority ?? DEFAULT_NOTE_PRIORITY;
}

/** Render a priority as a capitalised display label. */
export function priorityLabel(priority: NotePriority): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

/** Rank a priority for sorting, highest urgency first (critical = 0). */
export function priorityRank(priority: NotePriority): number {
  return PRIORITY_LEVELS.indexOf(priority);
}
