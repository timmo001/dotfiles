import { Effect } from "effect";

/** Format fields as a pipe-delimited machine-readable row. */
export function pipeRow(
  fields: readonly (string | null | undefined)[],
): string {
  return fields.map(pipeField).join("|");
}

/** Write text to stdout exactly as provided. */
export function writeText(text: string): Effect.Effect<void> {
  return Effect.sync(() => process.stdout.write(text));
}

/** Write one JSON-encoded value followed by a newline. */
export function writeJsonLine(value: unknown): Effect.Effect<void> {
  return writeText(`${JSON.stringify(value)}\n`);
}

/** Write pipe-delimited rows followed by newlines. */
export function writeRows(rows: Iterable<string>): Effect.Effect<void> {
  return Effect.sync(() => {
    for (const row of rows) process.stdout.write(`${row}\n`);
  });
}

/** Format an unknown command error for CLI output. */
export function formatCommandError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return String(error);
}

/** Print a labelled command error and exit non-zero. */
export function handleCommandError(label: string) {
  return Effect.catch((error: unknown) =>
    Effect.sync(() => {
      console.error(`[${label}] ${formatCommandError(error)}`);
      process.exit(1);
    }),
  );
}

function pipeField(value: string | null | undefined): string {
  return (value ?? "").replace(/[|\r\n]+/g, " ").trim();
}
