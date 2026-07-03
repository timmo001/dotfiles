/**
 * @file MCP notes tools.
 *
 * Registers `note_read`, `note_list`, `note_write`, and `note_delete` directly
 * on the MCP server, backed by the in-process {@link Notes} service. Tools are
 * registered at the `McpServer` level (rather than via a toolkit) so their
 * results are returned as raw text: `note_read` yields raw markdown and
 * `note_list` yields plain JSON, matching the previous repo-notes plugin rather
 * than JSON-escaping every result. Mutating tools emit a desktop notification
 * via {@link Notifier}.
 */
import { Effect, Schema } from "effect";
import { Notes } from "../../notes/services/Notes.js";
import type {
  NoteDeleteResult,
  NoteEntry,
  NoteRepoSection,
  NoteWriteResult,
} from "../../notes/types.js";
import { Notifier, type NotifierService } from "../services/Notifier.js";
import {
  DESTRUCTIVE_HINTS,
  makeToolRegistrar,
  READONLY_HINTS,
} from "./register.js";

const NoteReadParams = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "Absolute path to the note file (e.g. /home/user/Documents/notes/repo-notes/owner/repo/slug.md)",
  }),
});

const NoteListParams = Schema.Struct({
  tag: Schema.optional(
    Schema.String.annotate({
      description:
        "Optional tag to filter notes by (e.g. 'handoff'). Only notes with this tag are returned.",
    }),
  ),
  all: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "List notes from all repositories instead of just the current one.",
    }),
  ),
});

const NoteWriteParams = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "Absolute path to the note file (e.g. /home/user/Documents/notes/repo-notes/owner/repo/slug.md)",
  }),
  content: Schema.String.annotate({
    description:
      "Full file content to write, including frontmatter and all sections",
  }),
});

const NoteDeleteParams = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "Absolute path to the note file to delete (e.g. /home/user/Documents/notes/repo-notes/owner/repo/slug.md)",
  }),
});

/** Case-insensitive tag match against a note entry. */
function hasTag(entry: NoteEntry, tag: string): boolean {
  const wanted = tag.toLowerCase();
  return entry.tags.some((t) => t.toLowerCase() === wanted);
}

/** Filter flat entries by tag. */
function filterEntriesByTag(
  entries: readonly NoteEntry[],
  tag: string,
): readonly NoteEntry[] {
  return entries.filter((entry) => hasTag(entry, tag));
}

/** Filter grouped sections by tag, dropping sections left empty. */
function filterSectionsByTag(
  sections: readonly NoteRepoSection[],
  tag: string,
): readonly NoteRepoSection[] {
  return sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) => hasTag(entry, tag)),
    }))
    .filter((section) => section.entries.length > 0);
}

/** Append the best-effort push outcome to a mutation's output text. */
function formatMutationOutput(
  result: NoteWriteResult | NoteDeleteResult,
): string {
  if (!result.push) return result.output;
  const pushLine = result.push.ok
    ? `Pushed: ${result.push.message}`
    : `Push failed (non-fatal): ${result.push.error ?? "unknown error"}`;
  return `${result.output}\n\n${pushLine}`;
}

/** Emit a desktop notification summarising a note mutation. */
function notifyMutation(
  notifier: NotifierService,
  action: string,
  result: NoteWriteResult | NoteDeleteResult,
): Effect.Effect<void> {
  const name = result.path.split("/").pop() || result.path;
  const detail = result.push
    ? result.push.ok
      ? result.push.message
      : `push failed: ${result.push.error ?? "unknown error"}`
    : "saved locally";
  return notifier.notify(`dot notes: ${action}`, `${name} - ${detail}`);
}

/**
 * Register the four note tools via the shared {@link makeToolRegistrar}.
 * Requires the {@link Notes} and {@link Notifier} services, resolved once here
 * so the tool handlers close over them and return raw text.
 */
export const registerNotesTools = Effect.gen(function* () {
  const register = yield* makeToolRegistrar;
  const notes = yield* Notes;
  const notifier = yield* Notifier;

  yield* register({
    name: "note_read",
    description:
      "Read the full content of a note file from the notes vault. " +
      "Use this to read an existing note before appending to it. " +
      "This is the ONLY permitted way to read note files - the built-in read tool is blocked for the notes vault.",
    parameters: NoteReadParams,
    annotations: READONLY_HINTS,
    handle: (params) => notes.read(params.path),
  });

  yield* register({
    name: "note_list",
    description:
      "List note files in the notes vault for the current repository. " +
      "Returns JSON with filename, name, description, tags, and modification time for each note. " +
      "Optionally filter by tag (e.g. 'handoff') or list notes from all repositories.",
    parameters: NoteListParams,
    annotations: READONLY_HINTS,
    handle: (params) =>
      Effect.gen(function* () {
        if (params.all) {
          const sections = yield* notes.listAll();
          const filtered = params.tag
            ? filterSectionsByTag(sections, params.tag)
            : sections;
          return JSON.stringify(filtered, null, 2);
        }
        const entries = yield* notes.list();
        const filtered = params.tag
          ? filterEntriesByTag(entries, params.tag)
          : entries;
        return JSON.stringify(filtered, null, 2);
      }),
  });

  yield* register({
    name: "note_write",
    description:
      "Write a note file to the notes vault, then commit and best-effort push it. " +
      "Creates parent directories automatically. " +
      "This is the ONLY permitted way to write note files - the built-in write, edit, and bash tools are blocked for the notes vault.",
    parameters: NoteWriteParams,
    annotations: DESTRUCTIVE_HINTS,
    handle: (params) =>
      Effect.gen(function* () {
        const result = yield* notes.write(params.path, params.content);
        yield* notifyMutation(notifier, "written", result);
        return formatMutationOutput(result);
      }),
  });

  yield* register({
    name: "note_delete",
    description:
      "Delete a note file from the notes vault, then commit and best-effort push it. " +
      "Use this to remove notes that are no longer needed (e.g. superseded handoffs, stale references). " +
      "IMPORTANT: deletion is irreversible; confirm with the user before calling this tool. " +
      "This is the ONLY permitted way to delete note files - the built-in bash and edit tools are blocked for the notes vault.",
    parameters: NoteDeleteParams,
    annotations: DESTRUCTIVE_HINTS,
    handle: (params) =>
      Effect.gen(function* () {
        const result = yield* notes.delete(params.path);
        yield* notifyMutation(notifier, "deleted", result);
        return formatMutationOutput(result);
      }),
  });
});
