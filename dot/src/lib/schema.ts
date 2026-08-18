import { Schema } from "effect";

/** JSON-compatible data accepted by generated configuration writers. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** JSON object decoded from an external boundary. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** Decode an external value as JSON-compatible data. */
export const decodeJson = Schema.decodeUnknownSync(Schema.Json);

/** Decode an external value as a JSON object. */
export const decodeJsonObject = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Json),
);

/** Whether a value is a string. */
export const isString = Schema.is(Schema.String);

/** Whether a value is a number. */
export const isNumber = Schema.is(Schema.Number);

/** Whether a value is a boolean. */
export const isBoolean = Schema.is(Schema.Boolean);

/** Whether a JSON value is an object rather than an array or null. */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return (
    value !== null &&
    !Array.isArray(value) &&
    !isString(value) &&
    !isNumber(value) &&
    !isBoolean(value)
  );
}

/** Return a readable message for an arbitrary failure cause. */
export function formatCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
