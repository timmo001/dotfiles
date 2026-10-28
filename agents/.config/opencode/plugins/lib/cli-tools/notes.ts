import {
  createNote,
  deleteNote,
  listAllHandoffs,
  listAllNotes,
  listHandoffs,
  listNotes,
  listNoteTargets,
  moveNote,
  noteContext,
  NotesLayer,
  NotesError,
  notesRoot,
  readNote,
  searchNotes,
  setNotePriority,
  writeNote,
} from "@timmo001/effect-notes";
import { Effect, Layer, Schema } from "effect";
import { type ClientNamespace, clientTools, commandExists } from "./tool";

const notePath = Schema.String.annotate({
  description: "Absolute path to a note file inside the notes vault",
});

const allProjects = Schema.optionalKey(Schema.Boolean).annotate({
  description: "Include notes from every projects directory, not only the current repository",
});

const tag = Schema.optionalKey(Schema.String).annotate({
  description: "Only include notes with this tag",
});

const tool = clientTools(Layer.empty);

const inProject = (directory: string) => Effect.provide(NotesLayer.make({ projectDir: directory }));

/** Repository notes and handoffs, run in-process through @timmo001/effect-notes. */
export const notesNamespace: ClientNamespace = {
  kind: "client",
  command: "notes",
  description:
    "Repository notes through @timmo001/effect-notes, in-process: read, search and change the repository's Markdown notes and handoffs. Changes are committed and pushed.",
  available: commandExists("git"),
  tools: [
    tool({
      name: "root",
      description: "Print the notes vault root, or the projects directory.",
      access: "read",
      input: Schema.Struct({
        projects: Schema.optionalKey(Schema.Boolean).annotate({
          description: "Print the projects directory instead",
        }),
      }),
      run: (input, { directory }) =>
        notesRoot({ projects: input.projects ?? false }).pipe(inProject(directory)),
    }),
    tool({
      name: "context",
      description:
        "Resolve the project-note context for the session's repository: its owner/repo slug, notes path and notes.",
      access: "read",
      input: Schema.Struct({}),
      run: (_input, { directory }) => noteContext("codemode").pipe(inProject(directory)),
    }),
    tool({
      name: "list",
      description: "List the repository's notes.",
      access: "read",
      pinned: true,
      input: Schema.Struct({ all: allProjects, tag }),
      run: (input, { directory }): Effect.Effect<unknown, NotesError> =>
        input.all
          ? listAllNotes({ tag: input.tag }).pipe(inProject(directory))
          : listNotes({ tag: input.tag }).pipe(inProject(directory)),
    }),
    tool({
      name: "search",
      description: "Fuzzy-search note metadata.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        query: Schema.String.annotate({ description: "Fuzzy search text" }),
        all: allProjects,
        tag,
      }),
      run: (input, { directory }) =>
        searchNotes({ query: input.query, all: input.all ?? false, tag: input.tag }).pipe(
          inProject(directory),
        ),
    }),
    tool({
      name: "read",
      description: "Read a note's content and SHA-256 revision hash.",
      access: "read",
      pinned: true,
      input: Schema.Struct({ path: notePath }),
      run: (input, { directory }) => readNote(input.path).pipe(inProject(directory)),
    }),
    tool({
      name: "targets",
      description: "List the known repository scopes notes can belong to.",
      access: "read",
      input: Schema.Struct({}),
      run: (_input, { directory }) => listNoteTargets().pipe(inProject(directory)),
    }),
    tool({
      name: "handoffs",
      description: "List handoff-tagged notes.",
      access: "read",
      input: Schema.Struct({ all: allProjects }),
      run: (input, { directory }): Effect.Effect<unknown, NotesError> =>
        input.all ? listAllHandoffs().pipe(inProject(directory)) : listHandoffs().pipe(inProject(directory)),
    }),
    tool({
      name: "write",
      description: "Replace a note's content, then commit and push it.",
      access: "write",
      input: Schema.Struct({
        path: notePath,
        content: Schema.String.annotate({ description: "The note's complete new content" }),
        expectedHash: Schema.optionalKey(Schema.String).annotate({
          description: "Fail if the note no longer has this SHA-256 hash, from read",
        }),
      }),
      summary: (input) => `write ${input.path}`,
      run: (input, { directory }) =>
        writeNote({ path: input.path, content: input.content, expectedHash: input.expectedHash }).pipe(
          inProject(directory),
        ),
    }),
    tool({
      name: "create",
      description: "Create a note, then commit and push it.",
      access: "write",
      input: Schema.Struct({
        name: Schema.String.annotate({ description: "Note name" }),
        content: Schema.String.annotate({ description: "The note body" }),
        description: Schema.String.annotate({ description: "Note description" }),
        repository: Schema.String.annotate({
          description: "Repository scope for the new note, such as timmo001/dotfiles, from targets or context",
        }),
        kind: Schema.optionalKey(Schema.Literals(["note", "handoff"])).annotate({
          description: "Note template kind (default: note)",
        }),
      }),
      summary: (input) => `create ${input.kind ?? "note"} "${input.name}" in ${input.repository}`,
      run: (input, { directory }) =>
        createNote({
          repository: input.repository,
          kind: input.kind ?? "note",
          name: input.name,
          description: input.description,
          body: input.content,
        }).pipe(inProject(directory)),
    }),
    tool({
      name: "delete",
      description: "Delete a note, then commit and push it.",
      access: "write",
      input: Schema.Struct({ path: notePath }),
      summary: (input) => `delete ${input.path}`,
      run: (input, { directory }) => deleteNote(input.path).pipe(inProject(directory)),
    }),
    tool({
      name: "move",
      description: "Move a note to another known repository scope, then commit and push it.",
      access: "write",
      input: Schema.Struct({
        path: notePath,
        to: Schema.String.annotate({ description: "Existing or remembered repository scope" }),
      }),
      summary: (input) => `move ${input.path} to ${input.to}`,
      run: (input, { directory }) => moveNote({ path: input.path, to: input.to }).pipe(inProject(directory)),
    }),
    tool({
      name: "priority",
      description: "Set a note's priority, then commit and push it.",
      access: "write",
      input: Schema.Struct({
        path: notePath,
        value: Schema.Literals(["low", "medium", "high", "critical"]),
      }),
      summary: (input) => `priority ${input.value} for ${input.path}`,
      run: (input, { directory }) =>
        setNotePriority({ path: input.path, priority: input.value }).pipe(inProject(directory)),
    }),
  ],
};
