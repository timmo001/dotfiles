/**
 * @file MCP context resources.
 *
 * Registers read-only resources on the MCP server: the current repository's
 * repo-note context block (`dot://notes/context`), its branch context
 * (`dot://git-context`), and per-command help (`dot://command/{name}`). Each
 * reuses the same in-process services as the context tools, so a client can
 * pull this context in as an attachment without an explicit tool call. Content
 * effects re-run on every read, so resources reflect the current state.
 */
import { Effect, Schema } from "effect";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { renderHelp } from "../../cli/help.js";
import { nativeCommandNames } from "../../cli/spec.js";
import {
  gitContextOptions,
  gitContextText,
} from "../../git/commands/Context.js";
import { Notes } from "../../notes/services/Notes.js";

/** Named template parameter for the per-command help resource. */
const commandParam = McpSchema.param("name", Schema.String);

/**
 * OpenCode command name used when rendering {@link Notes.context} for the
 * `dot://notes/context` resource. `notes-list` includes the current
 * repository's note list in the rendered block.
 */
const CONTEXT_COMMAND = "notes-list";

/**
 * Register the read-only context resources on the current
 * {@link McpServer}. Requires {@link Notes} and `CommandExecutor`, provided by
 * the CLI layer stack when launched; both are supplied to the content effects
 * from the ambient context on each read.
 */
export const registerContextResources = Effect.gen(function* () {
  yield* McpServer.registerResource({
    uri: "dot://notes/context",
    name: "repo note context",
    description:
      "The current repository's OpenCode repo-note context block: repository identity, notes path, and recent notes.",
    mimeType: "text/markdown",
    content: Effect.gen(function* () {
      const notes = yield* Notes;
      return yield* notes.context({ command: CONTEXT_COMMAND });
    }),
  });

  yield* McpServer.registerResource({
    uri: "dot://git-context",
    name: "git context",
    description:
      "Concise branch context for the current repository: branch/base header, the pull request summary for a feature branch, unstaged files, staged files, and recent commits with push markers.",
    mimeType: "text/plain",
    content: gitContextText(gitContextOptions({})),
  });

  yield* McpServer.registerResource`dot://command/${commandParam}`({
    name: "dot command help",
    description:
      "Help text for a single dot command, e.g. dot://command/git-context.",
    mimeType: "text/plain",
    completion: {
      name: (input) =>
        Effect.succeed(
          [...nativeCommandNames]
            .filter((name) => name.startsWith(input))
            .sort(),
        ),
    },
    content: (_uri, name) => Effect.sync(() => renderHelp(name)),
  });
});
