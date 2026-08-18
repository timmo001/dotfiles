/**
 * @file Prettier-compatible JSON serialiser for generated harness configs.
 *
 * Matches the hand-authored style of the MCP config files: 2-space indent,
 * non-empty objects always broken onto multiple lines, and arrays kept inline
 * while they fit within the print width, otherwise one element per line. This
 * keeps `dot mcp-sync` output diff-clean against the existing files without
 * bundling Prettier into the binary.
 */
import { Schema } from "effect";
import { isJsonObject, type JsonValue } from "../../lib/schema.js";

const PRINT_WIDTH = 80;
const INDENT = "  ";

function pad(depth: number): string {
  return INDENT.repeat(depth);
}

const isJsonPrimitive = Schema.is(
  Schema.Union([Schema.Null, Schema.String, Schema.Number, Schema.Boolean]),
);

function formatInline(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(formatInline).join(", ")}]`;
  }
  if (isJsonObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{ ${entries
      .map(([key, item]) => `${JSON.stringify(key)}: ${formatInline(item)}`)
      .join(", ")} }`;
  }
  return JSON.stringify(value);
}

function formatValue(value: JsonValue, depth: number, column: number): string {
  if (Array.isArray(value)) return formatArray(value, depth, column);
  if (isJsonObject(value)) {
    return formatObject(value, depth);
  }
  return JSON.stringify(value);
}

function formatArray(
  value: readonly JsonValue[],
  depth: number,
  column: number,
): string {
  if (value.length === 0) return "[]";
  const inline = formatInline(value);
  if (value.every(isJsonPrimitive) && column + inline.length <= PRINT_WIDTH) {
    return inline;
  }
  const items = value
    .map(
      (item) =>
        `${pad(depth + 1)}${formatValue(item, depth + 1, pad(depth + 1).length)}`,
    )
    .join(",\n");
  return `[\n${items}\n${pad(depth)}]`;
}

function formatObject(
  value: { readonly [key: string]: JsonValue },
  depth: number,
): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  const lines = entries.map(([key, item]) => {
    const keyText = `${JSON.stringify(key)}: `;
    const column = pad(depth + 1).length + keyText.length;
    return `${pad(depth + 1)}${keyText}${formatValue(item, depth + 1, column)}`;
  });
  return `{\n${lines.join(",\n")}\n${pad(depth)}}`;
}

/** Serialise a value as prettier-style JSON with a trailing newline. */
export function formatJson(value: JsonValue): string {
  return `${formatValue(value, 0, 0)}\n`;
}
