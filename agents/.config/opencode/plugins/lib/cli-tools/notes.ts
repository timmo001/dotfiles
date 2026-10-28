import { Schema } from "effect";
import { type CliTool, defineCliTool, switchFlag, valueFlag } from "./tool";

const notePath = Schema.String.annotate({
  description: "Absolute path to a note file inside the notes vault",
});

const allProjects = Schema.optionalKey(Schema.Boolean).annotate({
  description: "Include notes from every projects directory, not only the current repository",
});

const tag = Schema.optionalKey(Schema.String).annotate({
  description: "Only include notes with this tag",
});

/** Notes CLI commands exposed as Code Mode tools. */
export const notesTools: readonly CliTool[] = [
  defineCliTool({
    name: "root",
    description: "Print the notes vault root, or the projects directory.",
    access: "read",
    json: false,
    input: Schema.Struct({
      projects: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Print the projects directory instead",
      }),
    }),
    invocation: (input) => ({ args: ["root", ...switchFlag("projects", input.projects)] }),
  }),
  defineCliTool({
    name: "context",
    description: "Resolve the project-note context for the session's repository.",
    access: "read",
    json: true,
    input: Schema.Struct({
      command: Schema.optionalKey(Schema.String).annotate({
        description: "Integration command name requesting context",
      }),
    }),
    invocation: (input) => ({
      args: ["context", "--json", ...valueFlag("command", input.command)],
    }),
  }),
  defineCliTool({
    name: "list",
    description: "List the repository's notes.",
    access: "read",
    pinned: true,
    json: true,
    input: Schema.Struct({ all: allProjects, tag }),
    invocation: (input) => ({
      args: [
        "list",
        "--format",
        "json",
        ...switchFlag("all", input.all),
        ...valueFlag("tag", input.tag),
      ],
    }),
  }),
  defineCliTool({
    name: "search",
    description: "Fuzzy-search note metadata.",
    access: "read",
    pinned: true,
    json: true,
    input: Schema.Struct({
      query: Schema.String.annotate({ description: "Fuzzy search text" }),
      all: allProjects,
      tag,
    }),
    invocation: (input) => ({
      args: [
        "search",
        "--format",
        "json",
        "--query",
        input.query,
        ...switchFlag("all", input.all),
        ...valueFlag("tag", input.tag),
      ],
    }),
  }),
  defineCliTool({
    name: "read",
    description: "Read a note's content and SHA-256 revision hash.",
    access: "read",
    pinned: true,
    json: true,
    input: Schema.Struct({ path: notePath }),
    invocation: (input) => ({ args: ["read", "--json", "--path", input.path] }),
  }),
  defineCliTool({
    name: "targets",
    description: "List the known repository scopes notes can belong to.",
    access: "read",
    json: true,
    input: Schema.Struct({}),
    invocation: () => ({ args: ["targets", "--format", "json"] }),
  }),
  defineCliTool({
    name: "handoffs",
    description: "List handoff-tagged notes.",
    access: "read",
    json: true,
    input: Schema.Struct({ all: allProjects }),
    invocation: (input) => ({
      args: ["handoffs", "--list", "--format", "json", ...switchFlag("all", input.all)],
    }),
  }),
  defineCliTool({
    name: "write",
    description: "Replace a note's content, then commit and push it.",
    access: "write",
    json: true,
    input: Schema.Struct({
      path: notePath,
      content: Schema.String.annotate({ description: "The note's complete new content" }),
      expectedHash: Schema.optionalKey(Schema.String).annotate({
        description: "Fail if the note no longer has this SHA-256 hash, from read",
      }),
    }),
    invocation: (input) => ({
      args: [
        "write",
        "--json",
        "--stdin",
        "--path",
        input.path,
        ...valueFlag("expected-hash", input.expectedHash),
      ],
      stdin: input.content,
    }),
  }),
  defineCliTool({
    name: "create",
    description: "Create a note, then commit and push it.",
    access: "write",
    json: true,
    input: Schema.Struct({
      name: Schema.String.annotate({ description: "Note name" }),
      content: Schema.String.annotate({ description: "The note body" }),
      description: Schema.optionalKey(Schema.String).annotate({ description: "Note description" }),
      repository: Schema.optionalKey(Schema.String).annotate({
        description: "Repository scope for the new note (default: the session's repository)",
      }),
      kind: Schema.optionalKey(Schema.Literals(["note", "handoff"])).annotate({
        description: "Note template kind",
      }),
    }),
    invocation: (input) => ({
      args: [
        "create",
        "--json",
        "--stdin",
        "--name",
        input.name,
        ...valueFlag("description", input.description),
        ...valueFlag("repository", input.repository),
        ...valueFlag("kind", input.kind),
      ],
      stdin: input.content,
    }),
  }),
  defineCliTool({
    name: "delete",
    description: "Delete a note, then commit and push it.",
    access: "write",
    json: true,
    input: Schema.Struct({ path: notePath }),
    invocation: (input) => ({ args: ["delete", "--json", "--path", input.path] }),
  }),
  defineCliTool({
    name: "move",
    description: "Move a note to another known repository scope.",
    access: "write",
    json: true,
    input: Schema.Struct({
      path: notePath,
      to: Schema.String.annotate({ description: "Existing or remembered repository scope" }),
    }),
    invocation: (input) => ({ args: ["move", "--json", "--path", input.path, "--to", input.to] }),
  }),
  defineCliTool({
    name: "priority",
    description: "Set a note's priority, then commit and push it.",
    access: "write",
    json: true,
    input: Schema.Struct({
      path: notePath,
      value: Schema.Literals(["low", "medium", "high", "critical"]),
    }),
    invocation: (input) => ({
      args: ["priority", "--json", "--path", input.path, "--value", input.value],
    }),
  }),
];
