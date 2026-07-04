/**
 * @file `dot stack-context` command entrypoints.
 *
 * Thin wrappers over the shared stack-context producer (`../context/detect.ts`)
 * and its renderers: text for humans/agents and JSON for the OpenCode
 * stack-context plugin. Detection is pure synchronous filesystem work, so these
 * wrap it in {@link Effect.sync} and require no services.
 */
import { Effect } from "effect";
import { resolve } from "node:path";
import { cliStyler, plainStyler, type Styler } from "../../lib/ansi.js";
import { writeText } from "../../git/commands/rows.js";
import { detectStack } from "../context/detect.js";
import {
  STACK_CONTEXT_DEFAULTS,
  type StackContextOptions,
} from "../context/model.js";
import { renderStackContextJson } from "../context/renderJson.js";
import { renderStackContextText } from "../context/renderText.js";

/** Resolve full stack-context options from partial overrides on the defaults. */
export function stackContextOptions(
  overrides: Partial<StackContextOptions>,
): StackContextOptions {
  return {
    root:
      overrides.root && overrides.root.length > 0
        ? resolve(overrides.root)
        : process.cwd(),
    maxDepth: overrides.maxDepth ?? STACK_CONTEXT_DEFAULTS.maxDepth,
    maxFiles: overrides.maxFiles ?? STACK_CONTEXT_DEFAULTS.maxFiles,
    topLocations: overrides.topLocations ?? STACK_CONTEXT_DEFAULTS.topLocations,
  };
}

/**
 * Build the stack-context text output. Defaults to the plain {@link plainStyler}
 * so string consumers (the MCP layer, tests) get unstyled text; pass a
 * colour-emitting `styler` for interactive CLI output.
 */
export function stackContextText(
  options: StackContextOptions,
  styler: Styler = plainStyler,
): Effect.Effect<string> {
  return Effect.sync(() =>
    renderStackContextText(detectStack(options), styler),
  ).pipe(Effect.withSpan("stackContext.text"));
}

/** Build the stack-context JSON output (plugin payload) for the given options. */
export function stackContextJson(
  options: StackContextOptions,
): Effect.Effect<string> {
  return Effect.sync(
    () => `${renderStackContextJson(detectStack(options))}\n`,
  ).pipe(Effect.withSpan("stackContext.json"));
}

/** CLI: write the stack-context text output to stdout, colourised on a TTY. */
export function stackContextRaw(
  options: StackContextOptions,
): Effect.Effect<void> {
  return stackContextText(options, cliStyler(process.stdout)).pipe(
    Effect.flatMap(writeText),
    Effect.withSpan("stackContext.raw"),
  );
}

/** CLI: write the stack-context JSON output to stdout. */
export function stackContextRawJson(
  options: StackContextOptions,
): Effect.Effect<void> {
  return stackContextJson(options).pipe(
    Effect.flatMap(writeText),
    Effect.withSpan("stackContext.rawJson"),
  );
}
