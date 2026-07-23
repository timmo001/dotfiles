/**
 * @file Injects session-attributed commit scope into commit command prompts.
 *
 * Combines current Context CLI output with persisted OpenCode patch parts so
 * commit commands can avoid a duplicate discovery round without treating every
 * dirty file as reviewed work.
 */

import type { Plugin } from "@opencode-ai/plugin";
import {
  collectSessionMessages,
  renderCommitContext,
} from "../lib/commit-context";

interface DirectoryQuery {
  readonly directory: string;
}

const TARGET_COMMANDS = new Set(["commit", "commit-push"]);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const CommitContextPlugin = (async ({ $, client, directory }) => {
  const query: DirectoryQuery | undefined = directory
    ? { directory }
    : undefined;

  return {
    "command.execute.before": async (input, output) => {
      if (!TARGET_COMMANDS.has(input.command)) return;

      const [contextResult, diffResult, sessionResult] =
        await Promise.allSettled([
          $`context git --json --no-pr`.cwd(directory).text(),
          $`context git --diff --no-pr`.cwd(directory).text(),
          collectSessionMessages(
            {
              session: (sessionID) =>
                client.session.get({
                  path: { id: sessionID },
                  ...(query ? { query } : {}),
                }),
              messages: (sessionID) =>
                client.session.messages({
                  path: { id: sessionID },
                  ...(query ? { query } : {}),
                }),
              children: (sessionID) =>
                client.session.children({
                  path: { id: sessionID },
                  ...(query ? { query } : {}),
                }),
            },
            input.sessionID,
          ),
        ]);
      const collectionWarnings: string[] = [];
      const context =
        contextResult.status === "fulfilled"
          ? (() => {
              try {
                return JSON.parse(
                  String(contextResult.value).trim(),
                ) as unknown;
              } catch (error) {
                collectionWarnings.push(
                  `Could not parse Context CLI output: ${errorMessage(error)}`,
                );
                return null;
              }
            })()
          : (() => {
              collectionWarnings.push(
                `Could not collect git context: ${errorMessage(contextResult.reason)}`,
              );
              return null;
            })();
      const session =
        sessionResult.status === "fulfilled"
          ? sessionResult.value
          : (() => {
              collectionWarnings.push(
                `Could not collect session changes: ${errorMessage(sessionResult.reason)}`,
              );
              return { sessions: [], warnings: [] };
            })();
      const diffEvidence =
        diffResult.status === "fulfilled"
          ? String(diffResult.value).trim()
          : (() => {
              collectionWarnings.push(
                `Could not collect diff evidence: ${errorMessage(diffResult.reason)}`,
              );
              return "";
            })();

      output.parts.unshift({
        type: "text",
        text: renderCommitContext({
          context,
          sessions: session.sessions,
          diffEvidence,
          collectionWarnings: [...collectionWarnings, ...session.warnings],
        }),
      });
    },
  };
}) satisfies Plugin;

export default CommitContextPlugin;
