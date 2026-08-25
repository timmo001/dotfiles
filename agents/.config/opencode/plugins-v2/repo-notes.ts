/**
 * @file Injects repository note context into OpenCode note commands.
 */

import { $ } from "bun";
import { Plugin } from "@opencode-ai/plugin/effect";
import { Effect, Result } from "effect";
import { errorMessage } from "../lib/error-message";

type RunNotes = (command: string, directory: string) => Promise<string>;

const NOTE_COMMANDS = [
  "note-create",
  "note-append",
  "notes-list",
  "notes-search",
  "note-reference",
  "handoff",
  "handoffs-list",
] as const;
const NOTE_COMMAND_SET = new Set<string>(NOTE_COMMANDS);
const COMMAND_MARKER = /<repo-note-command>([^<]+)<\/repo-note-command>/;

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const runNotes: RunNotes = (command, directory) =>
  $`notes context --command ${command}`.cwd(directory).text();

export const collectRepoNoteContext = Effect.fn("RepoNotes.collectContext")(
  function* (
    command: string,
    directory: Effect.Effect<string, unknown>,
    execute: RunNotes = runNotes,
  ) {
    const result = yield* Effect.gen(function* () {
      const cwd = yield* directory;
      return String(
        yield* Effect.tryPromise({
          try: () => execute(command, cwd),
          catch: (error) => error,
        }),
      ).trim();
    }).pipe(Effect.result);

    return Result.isSuccess(result)
      ? result.success
      : `<repo-note-context>\n\n<warnings>\nDescription: Issues encountered while collecting repository note context.\nRepoNotesPlugin could not collect note context because \`notes context\` failed.\nError: ${escapeXml(errorMessage(result.failure))}\n</warnings>\n\n</repo-note-context>`;
  },
);

export default Plugin.define({
  id: "repo-notes",
  effect: (context) =>
    Effect.gen(function* () {
      yield* context.command.transform((commands) => {
        for (const name of NOTE_COMMANDS) {
          commands.add({
            name,
            execute: (input) =>
              context.session.prompt({
                sessionID: input.sessionID,
                text: `<repo-note-command>${name}</repo-note-command>\n\n${input.prompt.text}`,
                files: input.prompt.files,
                agents: input.prompt.agents,
                skills: input.prompt.skills,
                delivery: input.delivery,
              }).pipe(Effect.asVoid),
          });
        }
      });

      yield* context.session.hook("context", (event) =>
        Effect.gen(function* () {
          const userMessage = event.messages.findLast((message) => message.role === "user");
          const command = userMessage?.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
            .match(COMMAND_MARKER)?.[1];
          if (!command || !NOTE_COMMAND_SET.has(command)) return;

          const text = yield* collectRepoNoteContext(
            command,
            context.session
              .get({ sessionID: event.sessionID })
              .pipe(Effect.map((session) => session.location.directory)),
          );
          event.system.unshift({ type: "text", text });
        }),
      );
    }),
});
