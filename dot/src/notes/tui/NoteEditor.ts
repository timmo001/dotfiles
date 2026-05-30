import type { CliRenderer } from "@opentui/core";
import type { NoteEntry } from "../types.js";

/** Supported terminal note editor launch modes. */
export type NoteEditorKind = "editor" | "visual";

const WAITING_VISUAL_EDITORS = new Set(["code", "cursor"]);

/** Suspend the TUI, launch the selected note in an editor, then resume. */
export async function openNoteInEditor(
  renderer: CliRenderer,
  entry: NoteEntry,
  kind: NoteEditorKind,
  afterResume?: () => void,
): Promise<void> {
  const command = editorCommand(entry, kind);
  renderer.suspend();
  renderer.currentRenderBuffer.clear();

  try {
    const proc = Bun.spawn(["bash", "-lc", command], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new NoteEditorExitError(exitCode);
  } finally {
    renderer.currentRenderBuffer.clear();
    renderer.resume();
    afterResume?.();
    renderer.requestRender();
  }
}

class NoteEditorExitError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`Editor exited with code ${exitCode}`);
    this.name = "NoteEditorExitError";
    this.exitCode = exitCode;
  }
}

function editorCommand(entry: NoteEntry, kind: NoteEditorKind): string {
  return `${resolveEditorCommand(kind)} ${shellQuote(entry.filePath)}`;
}

function resolveEditorCommand(kind: NoteEditorKind): string {
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
  const match = command.trim().match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
