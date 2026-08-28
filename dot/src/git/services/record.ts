import { Schema } from "effect";

const stringOption = Schema.decodeUnknownOption(Schema.String);
const stderrOption = Schema.decodeUnknownOption(
  Schema.Struct({ stderr: Schema.String }),
);

/** Return a string value from an unknown API field, or an empty string. */
export function stringValue(
  value: typeof Schema.Json.Type | undefined,
): string {
  return stringOption(value).pipe((option) =>
    option._tag === "Some" ? option.value : "",
  );
}

/** Return a non-empty string value from an unknown API field, or null. */
export function nullableStringValue(
  value: typeof Schema.Json.Type | undefined,
): string | null {
  const option = stringOption(value);
  return option._tag === "Some" && option.value.length > 0
    ? option.value
    : null;
}

/** Extract a readable message from `gh` command errors. */
export function formatGhError(cause: unknown): string {
  return (
    stderrMessage(cause) ??
    (cause instanceof Error ? cause.message : String(cause))
  );
}

function stderrMessage(cause: unknown): string | null {
  const option = stderrOption(cause);
  return option._tag === "Some" && option.value.stderr.length > 0
    ? option.value.stderr
    : null;
}
