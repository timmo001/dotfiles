/**
 * @file MCP context tools.
 *
 * Registers read-only context tools on the MCP server: `git_context` (current
 * repository branch context), `command_help` (dot CLI help), and
 * `opencode_debug` (captured `opencode debug` output). Each reuses existing
 * string-returning code where it exists (`gitContextText`, `renderHelp`) or is
 * rebuilt over {@link CommandExecutor} where the CLI handler is TUI-bound, so
 * results are raw text and never touch the JSON-RPC stdout stream. Tools are
 * registered via the shared {@link makeToolRegistrar}.
 */
import { Effect, Schema } from "effect";
import { renderHelp } from "../../cli/help.js";
import {
  gitContextOptions,
  gitContextText,
} from "../../git/commands/Context.js";
import {
  stackContextOptions,
  stackContextText,
} from "../../stack/commands/Context.js";
import { GitHub } from "../../git/services/GitHub.js";
import {
  CommandExecutor,
  type CommandExecutorService,
} from "../../services/CommandExecutor.js";
import { makeToolRegistrar, READONLY_HINTS } from "./register.js";

const GitContextParams = Schema.Struct({
  diff: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Append the full unstaged and staged diffs beneath each working-tree section.",
    }),
  ),
  branchDiff: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Append the full merge-base diff of the current branch against the default branch. Errors when HEAD is on the default branch.",
    }),
  ),
  comments: Schema.optional(
    Schema.Boolean.annotate({
      description: "Include pull request conversation comments.",
    }),
  ),
  reviews: Schema.optional(
    Schema.Boolean.annotate({
      description: "Include individual pull request reviews.",
    }),
  ),
  labels: Schema.optional(
    Schema.Boolean.annotate({
      description: "Include pull request labels.",
    }),
  ),
  checks: Schema.optional(
    Schema.Boolean.annotate({
      description: "Include CI check runs (makes a second gh call).",
    }),
  ),
  description: Schema.optional(
    Schema.Boolean.annotate({
      description: "Include the pull request description (default true).",
    }),
  ),
  pullRequest: Schema.optional(
    Schema.Boolean.annotate({
      description: "Include the pull request block at all (default true).",
    }),
  ),
  remotes: Schema.optional(
    Schema.Boolean.annotate({
      description: "Include remote fetch/push URLs in the branch metadata.",
    }),
  ),
  since: Schema.optional(
    Schema.String.annotate({
      description:
        "Only include recent commits after this ISO 8601 timestamp. Feature branches still list their full branch-unique commits.",
    }),
  ),
});

const StackContextParams = Schema.Struct({
  dir: Schema.optional(
    Schema.String.annotate({
      description:
        "Directory to scan (default: the server's current working directory).",
    }),
  ),
});

const CommandHelpParams = Schema.Struct({
  name: Schema.optional(
    Schema.String.annotate({
      description:
        "Optional subcommand to scope help to (e.g. 'git-context'). Omit for the full dot command overview.",
    }),
  ),
});

const OpencodeDebugParams = Schema.Struct({
  agent: Schema.optional(
    Schema.String.annotate({
      description:
        "Optional agent name to additionally inspect via `opencode debug agent <name>`.",
    }),
  ),
});

/** The `opencode debug` subcommands run by the `opencode_debug` tool. */
const OPENCODE_DEBUG_SECTIONS: readonly (readonly [
  string,
  readonly string[],
])[] = [
  ["opencode debug paths", ["debug", "paths"]],
  ["opencode debug config", ["debug", "config"]],
  ["opencode debug skill", ["debug", "skill"]],
  ["opencode debug info", ["debug", "info"]],
];

/**
 * Run the `opencode debug` subcommands and return their combined output as one
 * text block. Guards on `opencode` being present, runs each section with
 * captured stdout, and renders a per-section error line instead of aborting the
 * whole tool when one subcommand fails. Never fails.
 */
function opencodeDebugText(
  executor: CommandExecutorService,
  agent: string | undefined,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const available = yield* executor.exitCode("which", ["opencode"]);
    if (available !== 0) return "OpenCode command not found in PATH";

    const sections = [...OPENCODE_DEBUG_SECTIONS];
    if (agent)
      sections.push([
        `opencode debug agent ${agent}`,
        ["debug", "agent", agent],
      ]);

    const rendered: string[] = [];
    for (const [label, args] of sections) {
      const body = yield* executor.run("opencode", args).pipe(
        Effect.map((output) => output.trim()),
        Effect.catch((error) =>
          Effect.succeed(
            `[error] exit ${error.exitCode}${
              error.stderr.trim() ? `: ${error.stderr.trim()}` : ""
            }`,
          ),
        ),
      );
      rendered.push(`## ${label}\n\n${body || "(no output)"}`);
    }
    return rendered.join("\n\n");
  });
}

/**
 * Register the read-only context tools via the shared {@link makeToolRegistrar}.
 * Resolves {@link CommandExecutor} and {@link GitHub} once so the `git_context`
 * and `opencode_debug` handlers run with them provided and return raw text.
 */
export const registerContextTools = Effect.gen(function* () {
  const register = yield* makeToolRegistrar;
  const executor = yield* CommandExecutor;
  const github = yield* GitHub;

  yield* register({
    name: "git_context",
    description:
      "Concise branch context for the current repository: repository/branch/base header, " +
      "ahead/behind state, the pull request for the branch (feature branches), unstaged " +
      "files, staged files, untracked files, branch changed files, and recent " +
      "commits, each with a relative timestamp, a pushed/local marker, and its changed files " +
      "with line counts. Include remote URLs, PR comments, reviews, labels, or CI checks, " +
      "or append full working-tree diffs or the merge-base diff against the default branch.",
    parameters: GitContextParams,
    annotations: READONLY_HINTS,
    handle: (params) =>
      gitContextText(
        gitContextOptions({
          diff: params.diff ?? false,
          branchDiff: params.branchDiff ?? false,
          since: params.since,
          comments: params.comments ?? false,
          reviews: params.reviews ?? false,
          labels: params.labels ?? false,
          checks: params.checks ?? false,
          description: params.description ?? true,
          pullRequest: params.pullRequest ?? true,
          remoteDetails: params.remotes ?? false,
        }),
      ).pipe(
        Effect.provideService(CommandExecutor, executor),
        Effect.provideService(GitHub, github),
      ),
  });

  yield* register({
    name: "stack_context",
    description:
      "Deterministic tech-stack summary for a directory: detected languages with " +
      "their general locations, package ecosystems (from manifests), and frameworks " +
      "(from declared dependencies). Uses no LLM and no external tools; reads only " +
      "manifests and an extension/filename census. Defaults to the current working " +
      "directory. Pass dir to scan a specific project.",
    parameters: StackContextParams,
    annotations: READONLY_HINTS,
    handle: (params) =>
      stackContextText(stackContextOptions({ root: params.dir })),
  });

  yield* register({
    name: "command_help",
    description:
      "Show dot CLI help. Omit name for the full command overview, or pass a subcommand " +
      "(e.g. 'git-context') to scope help to that command.",
    parameters: CommandHelpParams,
    annotations: READONLY_HINTS,
    handle: (params) => Effect.sync(() => renderHelp(params.name)),
  });

  yield* register({
    name: "opencode_debug",
    description:
      "Run the OpenCode debug commands (paths, config, skill, info) and return their " +
      "combined output. Optionally also inspect a configured agent by name.",
    parameters: OpencodeDebugParams,
    annotations: READONLY_HINTS,
    handle: (params) => opencodeDebugText(executor, params.agent),
  });
});
