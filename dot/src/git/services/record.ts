/** Return a string value from an unknown API field, or an empty string. */
export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Return a non-empty string value from an unknown API field, or null. */
export function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Return a GitHub numeric/string ID as a string, or null. */
export function nullableIdValue(value: unknown): string | null {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : null;
}

/** Extract a readable message from `gh` command errors. */
export function formatGhError(error: unknown): string {
  return (
    stderrMessage(error) ??
    (error instanceof Error ? error.message : String(error))
  );
}

function stderrMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("stderr" in error)) return null;
  const stderr = (error as { readonly stderr?: unknown }).stderr;
  return typeof stderr === "string" && stderr.length > 0 ? stderr : null;
}
