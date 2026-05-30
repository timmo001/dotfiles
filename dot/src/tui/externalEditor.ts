import type { CliRenderer } from "@opentui/core";

/** Supported external editor launch modes. */
export type ExternalEditorKind = "editor" | "visual";

const WAITING_VISUAL_EDITORS = new Set(["code", "cursor"]);
const QUOTED_TOKEN_PATTERN = /^(['"])(.*)\1$/;

/** Suspend the TUI, launch a path in an external editor, then resume. */
export async function openPathInEditor(
  renderer: CliRenderer,
  path: string,
  kind: ExternalEditorKind,
  afterResume?: () => void,
): Promise<void> {
  const command = editorCommand(path, kind);
  renderer.suspend();
  renderer.currentRenderBuffer.clear();

  try {
    const proc = Bun.spawn(["bash", "-lc", command], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new ExternalEditorExitError(exitCode);
  } finally {
    renderer.currentRenderBuffer.clear();
    renderer.resume();
    afterResume?.();
    renderer.requestRender();
  }
}

/** Human-readable label for an external editor launch mode. */
export function editorLabel(kind: ExternalEditorKind): string {
  return kind === "visual" ? "visual editor" : "editor";
}

class ExternalEditorExitError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`Editor exited with code ${exitCode}`);
    this.name = "ExternalEditorExitError";
    this.exitCode = exitCode;
  }
}

function editorCommand(path: string, kind: ExternalEditorKind): string {
  return `${resolveEditorCommand(kind)} ${shellQuote(path)}`;
}

function resolveEditorCommand(kind: ExternalEditorKind): string {
  const command =
    kind === "visual"
      ? firstNonEmpty(process.env.VISUAL, process.env.EDITOR, "nvim")
      : firstNonEmpty(process.env.EDITOR, "nvim");

  return kind === "visual" ? withWaitFlag(command) : command;
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string {
  return (
    values.find((value) => value && value.trim().length > 0)?.trim() ?? "nvim"
  );
}

function withWaitFlag(command: string): string {
  if (!needsWaitFlag(command) || hasWaitFlag(command)) return command;
  return `${command} --wait`;
}

function needsWaitFlag(command: string): boolean {
  const name = commandName(command);
  return name ? WAITING_VISUAL_EDITORS.has(name) : false;
}

function hasWaitFlag(command: string): boolean {
  return /(?:^|\s)(?:--wait(?:[=\s]|$)|-w(?:\s|$))/.test(command);
}

function commandName(command: string): string | null {
  const token = firstShellToken(command);
  if (!token) return null;
  return token.split(/[\\/]/).pop()?.toLowerCase() ?? null;
}

function firstShellToken(command: string): string | null {
  const token = command.trim().match(/^(?:"[^"]+"|'[^']+'|\S+)/)?.[0];
  return token ? token.replace(QUOTED_TOKEN_PATTERN, "$2") : null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
