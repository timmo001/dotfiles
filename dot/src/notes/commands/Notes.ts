import { Effect } from "effect";
import { hasOption, optionValue } from "../../lib/args.js";
import { Notes, NotesError } from "../services/Notes.js";
import {
  formatNoteLabel,
  formatNoteSections,
  type NoteDeleteResult,
  type NotePushResult,
  type NotesListFormat,
  type NoteWriteResult,
} from "../types.js";

function notesUsage(): string {
  return `Usage: dot notes [--all] [command] [options]

Modes:
  (default)                    Interactive notes TUI
  --all                        Interactive notes TUI across all repos

Commands:
  root                         Print the notes vault root
  root --repo-notes            Print the repository notes directory
  context --command <name>     Print the context block for OpenCode notes
  list [--all] [--format labels|json]
                               List notes for the current repository or all repos

Examples:
  dot notes
  dot notes --all
  dot notes root
  dot notes context --command notes-list
  dot notes list --all
  dot notes list --format json`;
}

function noteUsage(): string {
  return `Usage: dot note <command> [options]

Commands:
  read --path <path>            Print a note file
  write --path <path> --stdin [--json]
                                Write stdin to a note file, then commit and push it
  delete --path <path> [--json] Delete a note file, then commit and push it

Examples:
  dot note read --path ~/Documents/notes/repo-notes/owner/repo/topic.md
  dot note write --path /tmp/notes/repo-notes/owner/repo/topic.md --stdin
  dot note delete --path /tmp/notes/repo-notes/owner/repo/topic.md`;
}

function invalid(message: string, usage: string): Effect.Effect<void> {
  return Effect.sync(() => {
    exitWithError([message, usage]);
  });
}

function handleNotesError<R>(effect: Effect.Effect<void, NotesError, R>) {
  return effect.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        exitWithError(
          error.detail
            ? [`[dot notes] ${error.message}`, error.detail]
            : [`[dot notes] ${error.message}`],
        );
      }),
    ),
  );
}

function writeText(text: string): Effect.Effect<void> {
  return Effect.sync(() => process.stdout.write(text));
}

function writeLine(text: string): Effect.Effect<void> {
  return writeText(`${text}\n`);
}

function exitWithError(lines: readonly string[]): never {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function parseListFormat(args: readonly string[]): NotesListFormat {
  const format = optionValue(args, "--format") ?? "labels";
  if (format === "labels" || format === "json") return format;
  exitWithError([
    `Unknown --format value: ${format} (expected: labels or json)`,
  ]);
}

/** Render the best-effort push outcome for a note mutation as a plain line. */
function formatPushLine(push: NotePushResult): string {
  return push.ok
    ? `Pushed to remote: ${push.message}`
    : `Push failed (non-fatal): ${push.error ?? "unknown error"}`;
}

/**
 * Emit a note write/delete result. With `--json` the push outcome is returned
 * on a separate `push` field so callers (the repo-notes plugin) can surface it
 * to the interactive session without folding it into the writing agent's output;
 * the plain form appends a human push line instead.
 */
function emitNoteResult(
  result: NoteWriteResult | NoteDeleteResult,
  json: boolean,
): Effect.Effect<void> {
  if (json) {
    return writeLine(
      JSON.stringify({ output: result.output, push: result.push ?? null }),
    );
  }
  return Effect.gen(function* () {
    yield* writeLine(result.output);
    if (result.push) yield* writeLine(formatPushLine(result.push));
  });
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
          yield* writeLine(root);
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
          yield* writeLine(context);
          return;
        }
        case "list": {
          const format = parseListFormat(rest);
          const all = hasOption(rest, "--all");
          if (all) {
            const sections = yield* notes.listAll();
            const output =
              format === "json"
                ? JSON.stringify(sections, null, 2)
                : formatNoteSections(sections);
            yield* writeLine(output);
            return;
          }

          const entries = yield* notes.list();
          const output =
            format === "json"
              ? JSON.stringify(entries, null, 2)
              : entries.map(formatNoteLabel).join("\n");
          yield* writeLine(output);
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
          yield* writeText(content);
          return;
        }
        case "write": {
          if (!rest.includes("--stdin")) {
            yield* invalid("dot note write requires --stdin", noteUsage());
            return;
          }
          const content = yield* Effect.promise(() => Bun.stdin.text());
          const result = yield* notes.write(filePath, content);
          yield* emitNoteResult(result, rest.includes("--json"));
          return;
        }
        case "delete": {
          const result = yield* notes.delete(filePath);
          yield* emitNoteResult(result, rest.includes("--json"));
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
