import { Effect } from "effect";
import { optionValue } from "../../lib/args.js";
import { Notes, NotesError } from "../services/Notes.js";
import { formatNoteLabel, type NotesListFormat } from "../types.js";

function notesUsage(): string {
  return `Usage: dot notes <command> [options]

Commands:
  root                         Print the notes vault root
  root --repo-notes            Print the repository notes directory
  context --command <name>     Print the context block for OpenCode notes
  list [--format labels|json]  List notes for the current repository

Examples:
  dot notes root
  dot notes context --command notes-list
  dot notes list --format json`;
}

function noteUsage(): string {
  return `Usage: dot note <command> [options]

Commands:
  read --path <path>            Print a note file
  write --path <path> --stdin   Write stdin to a note file and commit it
  delete --path <path>          Delete a note file and commit it

Examples:
  dot note read --path ~/Documents/notes/repo-notes/owner/repo/topic.md
  dot note write --path /tmp/notes/repo-notes/owner/repo/topic.md --stdin
  dot note delete --path /tmp/notes/repo-notes/owner/repo/topic.md`;
}

function invalid(message: string, usage: string): Effect.Effect<void> {
  return Effect.sync(() => {
    console.error(message);
    console.error(usage);
    process.exit(1);
  });
}

function handleNotesError<R>(effect: Effect.Effect<void, NotesError, R>) {
  return effect.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(`[dot notes] ${error.message}`);
        if (error.detail) console.error(error.detail);
        process.exit(1);
      }),
    ),
  );
}

function parseListFormat(args: readonly string[]): NotesListFormat {
  const format = optionValue(args, "--format") ?? "labels";
  if (format === "labels" || format === "json") return format;
  console.error(`Unknown --format value: ${format} (expected: labels or json)`);
  process.exit(1);
}

/** Execute the native `dot notes` command namespace. */
export function notesCommand(args: readonly string[]) {
  const subcommand = args[0];
  const rest = args.slice(1);

  return handleNotesError(
    Effect.gen(function* () {
      const notes = yield* Notes;

      switch (subcommand) {
        case "root": {
          const root = rest.includes("--repo-notes")
            ? yield* notes.repoNotesRoot
            : yield* notes.root;
          yield* Effect.sync(() => process.stdout.write(`${root}\n`));
          return;
        }
        case "context": {
          const command = optionValue(rest, "--command");
          if (!command) {
            yield* invalid(
              "dot notes context requires --command <name>",
              notesUsage(),
            );
            return;
          }
          const context = yield* notes.context({ command });
          yield* Effect.sync(() => process.stdout.write(`${context}\n`));
          return;
        }
        case "list": {
          const format = parseListFormat(rest);
          const entries = yield* notes.list();
          const output =
            format === "json"
              ? JSON.stringify(entries, null, 2)
              : entries.map(formatNoteLabel).join("\n");
          yield* Effect.sync(() => process.stdout.write(`${output}\n`));
          return;
        }
        default:
          yield* invalid(
            `dot notes: unknown command '${subcommand ?? ""}'`,
            notesUsage(),
          );
      }
    }),
  );
}

/** Execute the native `dot note` command namespace. */
export function noteCommand(args: readonly string[]) {
  const subcommand = args[0];
  const rest = args.slice(1);

  return handleNotesError(
    Effect.gen(function* () {
      const notes = yield* Notes;
      const filePath = optionValue(rest, "--path");

      if (!filePath) {
        yield* invalid(
          `dot note ${subcommand ?? ""} requires --path <path>`,
          noteUsage(),
        );
        return;
      }

      switch (subcommand) {
        case "read": {
          const content = yield* notes.read(filePath);
          yield* Effect.sync(() => process.stdout.write(content));
          return;
        }
        case "write": {
          if (!rest.includes("--stdin")) {
            yield* invalid("dot note write requires --stdin", noteUsage());
            return;
          }
          const content = yield* Effect.promise(() => Bun.stdin.text());
          const result = yield* notes.write(filePath, content);
          yield* Effect.sync(() => process.stdout.write(`${result.output}\n`));
          return;
        }
        case "delete": {
          const result = yield* notes.delete(filePath);
          yield* Effect.sync(() => process.stdout.write(`${result.output}\n`));
          return;
        }
        default:
          yield* invalid(
            `dot note: unknown command '${subcommand ?? ""}'`,
            noteUsage(),
          );
      }
    }),
  );
}
