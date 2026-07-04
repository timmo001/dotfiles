/**
 * @file `dot git-context` command entrypoints.
 *
 * Thin wrappers over the shared branch-context producer (`../context/build.ts`)
 * and its renderers: text for humans/agents and JSON for the OpenCode
 * branch-context plugin. Option parsing lives in the CLI/MCP layers; these
 * functions take a fully-resolved {@link BranchContextOptions}.
 */
import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { GitHub } from "../services/GitHub.js";
import { buildBranchContext } from "../context/build.js";
import {
  GIT_CONTEXT_DEFAULTS,
  type BranchContextOptions,
} from "../context/model.js";
import { renderBranchContextJson } from "../context/renderJson.js";
import { renderBranchContextText } from "../context/renderText.js";
import { handleCommandError, writeText } from "./rows.js";

const handleContextError = handleCommandError("dot git-context");

/** Resolve full git-context options from partial overrides on the defaults. */
export function gitContextOptions(
  overrides: Partial<BranchContextOptions>,
): BranchContextOptions {
  return { ...GIT_CONTEXT_DEFAULTS, ...overrides };
}

/** Build the git-context text output for the given options. */
export function gitContextText(
  options: BranchContextOptions,
): Effect.Effect<string, Error, CommandExecutor | GitHub> {
  return buildBranchContext(options).pipe(
    Effect.map(renderBranchContextText),
    Effect.withSpan("gitContext.text"),
  );
}

/** Build the git-context JSON output (plugin payload) for the given options. */
export function gitContextJson(
  options: BranchContextOptions,
): Effect.Effect<string, Error, CommandExecutor | GitHub> {
  return buildBranchContext(options).pipe(
    Effect.map((data) => `${renderBranchContextJson(data)}\n`),
    Effect.withSpan("gitContext.json"),
  );
}

/** CLI: write the git-context text output to stdout. */
export function gitContextRaw(
  options: BranchContextOptions,
): Effect.Effect<void, never, CommandExecutor | GitHub> {
  return gitContextText(options).pipe(
    Effect.flatMap(writeText),
    Effect.withSpan("gitContext.raw"),
    handleContextError,
  );
}

/** CLI: write the git-context JSON output to stdout. */
export function gitContextRawJson(
  options: BranchContextOptions,
): Effect.Effect<void, never, CommandExecutor | GitHub> {
  return gitContextJson(options).pipe(
    Effect.flatMap(writeText),
    Effect.withSpan("gitContext.rawJson"),
    handleContextError,
  );
}
