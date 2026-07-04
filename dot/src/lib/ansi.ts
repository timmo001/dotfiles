/**
 * @file Shared ANSI styling for CLI text output.
 *
 * Exposes the raw escape-code palette used by the output log and a small
 * {@link Styler} abstraction for semantic, colour-gated styling of query-style
 * command output (headings, inline commands, warnings). Colour is only emitted
 * on an interactive TTY with `NO_COLOR` unset; every other consumer (pipes,
 * redirects, captured agent context, the MCP layer) receives the plain no-op
 * styler so text output stays byte-identical.
 */
import { ENV, envString } from "./env.js";

/** Raw ANSI escape codes for terminal styling. */
export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
} as const;

/**
 * Whether ANSI colour should be emitted for `stream`.
 *
 * True only on an interactive TTY with `NO_COLOR` unset (or empty), so piped,
 * redirected, and captured output stays plain.
 */
export function colorEnabled(
  stream: { readonly isTTY?: boolean } = process.stdout,
): boolean {
  const noColor = envString(ENV.NO_COLOR);
  if (noColor !== undefined && noColor !== "") return false;
  return stream.isTTY === true;
}

/**
 * Semantic styler for CLI text output. Each method returns its input unchanged
 * when colour is disabled, so callers can style unconditionally.
 */
export interface Styler {
  /** Style a section or field heading (bold cyan). */
  readonly heading: (text: string) => string;
  /** Style an inline field label such as a PR metadata key (bold). */
  readonly label: (text: string) => string;
  /** Style an inline command or flag (green). */
  readonly command: (text: string) => string;
  /** Style de-emphasised text such as a local marker (dim). */
  readonly dim: (text: string) => string;
  /** Style a success marker such as a pushed commit (green). */
  readonly success: (text: string) => string;
  /** Style a warning line (yellow). */
  readonly warn: (text: string) => string;
  /**
   * Highlight markdown inline-code spans (`` `code` ``) within a line, dropping
   * the backticks and colouring the content as a command.
   */
  readonly markdown: (text: string) => string;
}

const identity = (text: string): string => text;

/** No-op styler used for non-TTY, piped, captured, and MCP output. */
export const plainStyler: Styler = {
  heading: identity,
  label: identity,
  command: identity,
  dim: identity,
  success: identity,
  warn: identity,
  markdown: identity,
};

/** Build a wrapper that surrounds text with `codes` and a trailing reset. */
function wrap(codes: string): (text: string) => string {
  return (text) => `${codes}${text}${ANSI.reset}`;
}

const command = wrap(ANSI.green);

/** Colour-emitting styler used on an interactive TTY. */
export const colorStyler: Styler = {
  heading: wrap(`${ANSI.bold}${ANSI.cyan}`),
  label: wrap(ANSI.bold),
  command,
  dim: wrap(ANSI.dim),
  success: command,
  warn: wrap(ANSI.yellow),
  markdown: (text) =>
    text.replace(/`([^`]+)`/g, (_match, code: string) => command(code)),
};

/** Resolve the styler for `stream`: colour on an interactive TTY, else plain. */
export function cliStyler(
  stream: { readonly isTTY?: boolean } = process.stdout,
): Styler {
  return colorEnabled(stream) ? colorStyler : plainStyler;
}
