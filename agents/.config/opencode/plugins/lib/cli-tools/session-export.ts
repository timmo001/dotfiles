/**
 * OpenCode session ids. Slashes are rejected so a default export path cannot leave its directory.
 */
export const sessionExportId = /^ses[A-Za-z0-9_-]+$/;

const EXPORT_DIR = "/tmp/opencode/session-exports";

/** Default export path for one session id. The id must already match {@link sessionExportId}. */
export const defaultSessionExportPath = (sessionID: string) => `${EXPORT_DIR}/${sessionID}.json`;

/**
 * Argv for `bash` that runs `command session export` with stdout as a file.
 * `opencode session export` exits 0 with a truncated JSON prefix when stdout is a pipe
 * (anomalyco/opencode#57266). A file is complete.
 */
export const sessionExportArgv = (
  command: string,
  sessionID: string,
  output: string,
  sanitize: boolean,
): readonly string[] => [
  "-c",
  'out=$1; shift; exec "$@" > "$out"',
  "bash",
  output,
  command,
  "session",
  "export",
  sessionID,
  ...(sanitize ? ["--sanitize"] : []),
];
