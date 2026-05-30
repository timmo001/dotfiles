/** Format fields as a pipe-delimited machine-readable row. */
export function pipeRow(
  fields: readonly (string | null | undefined)[],
): string {
  return fields.map(pipeField).join("|");
}

function pipeField(value: string | null | undefined): string {
  return (value ?? "").replace(/[|\r\n]+/g, " ").trim();
}
