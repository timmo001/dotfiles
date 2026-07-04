import { Effect } from "effect";
import { Notes, NotesError } from "../services/Notes.js";
import {
  formatNoteLabel,
  notePriority,
  priorityLabel,
  type NoteEntry,
  type NoteRepoSection,
} from "../types.js";

/** Render a handoff label prefixed with its effective priority. */
function formatHandoffLabel(entry: NoteEntry): string {
  return `[${priorityLabel(notePriority(entry))}] ${formatNoteLabel(entry)}`;
}

/** Render repo-grouped handoff labels with Markdown-style section headings. */
function formatHandoffSections(sections: readonly NoteRepoSection[]): string {
  return sections
    .map((section) =>
      [
        `## ${section.repoSlug}`,
        ...section.entries.map(formatHandoffLabel),
      ].join("\n"),
    )
    .join("\n\n");
}

/** Execute `dot handoffs --list [--all]`: list handoff-tagged notes to stdout. */
export function handoffsList(all: boolean) {
  return Effect.gen(function* () {
    const notes = yield* Notes;

    if (all) {
      const sections = yield* notes.listAll();
      const filtered = sections
        .map((section) => ({
          ...section,
          entries: section.entries.filter((entry) =>
            entry.tags.some((tag) => tag.toLowerCase() === "handoff"),
          ),
        }))
        .filter((section) => section.entries.length > 0);

      if (filtered.length === 0) {
        process.stdout.write("No handoff notes found.\n");
        return;
      }
      process.stdout.write(formatHandoffSections(filtered) + "\n");
    } else {
      const entries = yield* notes.list();
      const filtered = entries.filter((entry) =>
        entry.tags.some((tag) => tag.toLowerCase() === "handoff"),
      );

      if (filtered.length === 0) {
        process.stdout.write("No handoff notes found.\n");
        return;
      }
      process.stdout.write(filtered.map(formatHandoffLabel).join("\n") + "\n");
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.promise(async () => {
        const message =
          error instanceof NotesError ? error.message : String(error);
        console.error(`[dot handoffs] ${message}`);
        process.exit(1);
      }),
    ),
  );
}
