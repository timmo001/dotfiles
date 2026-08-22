/**
 * @file Injects repository note context into OpenCode note commands.
 */

import { $ } from "bun";
import { Plugin } from "@opencode-ai/plugin";

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

const errorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
    if (stderr) return stderr;
    if (typeof record.message === "string" && record.message) return record.message;
  }
  return String(error);
};

export default Plugin.define({
  id: "repo-notes",
  setup: async (context) => {
    await context.command.transform((commands) => {
      for (const name of NOTE_COMMANDS) {
        commands.update(name, (command) => {
          command.template = `<repo-note-command>${name}</repo-note-command>\n\n${command.template}`;
        });
      }
    });

    await context.session.hook("context", async (event) => {
      const userMessage = event.messages.findLast((message) => message.role === "user");
      const command = userMessage?.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .match(COMMAND_MARKER)?.[1];
      if (!command || !NOTE_COMMAND_SET.has(command)) return;

      try {
        const session = await context.session.get({ sessionID: event.sessionID });
        const noteContext = String(
          await $`notes context --command ${command}`
            .cwd(session.location.directory)
            .text(),
        ).trim();
        event.system.unshift({ type: "text", text: noteContext });
      } catch (error) {
        event.system.unshift({
          type: "text",
          text: `<repo-note-context>\n\n<warnings>\nDescription: Issues encountered while collecting repository note context.\nRepoNotesPlugin could not collect note context because \`notes context\` failed.\nError: ${escapeXml(errorMessage(error))}\n</warnings>\n\n</repo-note-context>`,
        });
      }
    });
  },
});
