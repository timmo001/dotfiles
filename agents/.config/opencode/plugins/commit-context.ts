/**
 * @file Injects session-attributed commit scope into commit command prompts.
 *
 * Combines current Context CLI output with persisted OpenCode patch parts so
 * commit commands can avoid a duplicate discovery round without treating every
 * dirty file as reviewed work.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { dirname } from "node:path";
import {
  collectSessionMessages,
  renderCommitContexts,
  sessionTouchedFiles,
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

      const collectionWarnings: string[] = [];
      const session = await collectSessionMessages(
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
      ).catch((error) => {
        collectionWarnings.push(
          `Could not collect session changes: ${errorMessage(error)}`,
        );
        return { sessions: [], warnings: [] };
      });
      const touchedFiles = sessionTouchedFiles(session.sessions);
      const filesByRoot = new Map<string, string[]>();
      const rootWarnings: string[] = [
        ...collectionWarnings,
        ...session.warnings,
      ];
      const activeCandidates = directory ? [directory] : [];
      for (const candidate of activeCandidates) {
        try {
          const root = String(
            await $`git -C ${candidate} rev-parse --show-toplevel`.text(),
          ).trim();
          filesByRoot.set(root, []);
        } catch (error) {
          rootWarnings.push(
            `Could not resolve repository for ${candidate}: ${errorMessage(error)}`,
          );
        }
      }
      for (const file of touchedFiles) {
        try {
          const root = String(
            await $`git -C ${dirname(file)} rev-parse --show-toplevel`.text(),
          ).trim();
          filesByRoot.set(root, [...(filesByRoot.get(root) ?? []), file]);
        } catch (error) {
          rootWarnings.push(
            `Could not resolve repository for ${file}: ${errorMessage(error)}`,
          );
        }
      }

      const contexts = await Promise.all(
        [...filesByRoot]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(async ([root, files]) => {
            const [contextResult, diffResult] = await Promise.allSettled([
              $`context git --json --no-pr`.cwd(root).text(),
              $`git diff HEAD --stat --no-ext-diff`.cwd(root).text(),
            ]);
            const collectionWarnings = [...rootWarnings];
            let context: unknown = null;
            if (contextResult.status === "fulfilled") {
              try {
                context = JSON.parse(
                  String(contextResult.value).trim(),
                ) as unknown;
              } catch (error) {
                collectionWarnings.push(
                  `Could not parse Context CLI output: ${errorMessage(error)}`,
                );
              }
            } else {
              collectionWarnings.push(
                `Could not collect git context: ${errorMessage(contextResult.reason)}`,
              );
            }
            const diffStat =
              diffResult.status === "fulfilled"
                ? String(diffResult.value).trim()
                : (() => {
                    collectionWarnings.push(
                      `Could not collect diff stat: ${errorMessage(diffResult.reason)}`,
                    );
                    return "";
                  })();
            return {
              context,
              sessions: session.sessions,
              touchedFiles: files,
              diffStat,
              collectionWarnings,
            };
          }),
      );

      output.parts.unshift({
        type: "text",
        text: renderCommitContexts(contexts, rootWarnings),
      });
    },
  };
}) satisfies Plugin;

export default CommitContextPlugin;
