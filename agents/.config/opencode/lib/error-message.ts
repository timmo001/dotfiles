export const errorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
    if (stderr) return stderr;
    if (typeof record.message === "string" && record.message) return record.message;
  }
  return String(error);
};
