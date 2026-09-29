import {
  isBoolean,
  isString,
  type JsonObject,
  type JsonValue,
} from "./schema.js";

/** Read a non-empty trimmed string, recording a diagnostic when invalid. */
export function requiredString(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): string | null {
  if (!isString(value) || value.trim().length === 0) {
    diagnostics.push(`${location} must be a non-empty string`);

    return null;
  }

  return value.trim();
}

/** Like {@link requiredString}, but a missing value is allowed and returns `null`. */
export function optionalString(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): string | null {
  if (value === undefined) return null;

  return requiredString(value, location, diagnostics);
}

/** Read a boolean, recording a diagnostic when invalid. */
export function requiredBoolean(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): boolean | null {
  if (!isBoolean(value)) {
    diagnostics.push(`${location} must be true or false`);

    return null;
  }

  return value;
}

/** Record a diagnostic for every key in `record` that is not in `allowed`. */
export function pushUnknownKeyDiagnostics(
  diagnostics: string[],
  record: JsonObject,
  allowed: ReadonlySet<string>,
  location: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key))
      diagnostics.push(`${location}.${key} is not supported`);
  }
}
