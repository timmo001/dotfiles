import type { CliRenderer } from "@opentui/core";
import type { NoteEntry } from "../types.js";
import {
  type ExternalEditorKind,
  openPathInEditor,
} from "../../tui/externalEditor.js";

/** Supported terminal note editor launch modes. */
export type NoteEditorKind = ExternalEditorKind;

/** Suspend the TUI, launch the selected note in an editor, then resume. */
export async function openNoteInEditor(
  renderer: CliRenderer,
  entry: NoteEntry,
  kind: NoteEditorKind,
  afterResume?: () => void,
): Promise<void> {
  await openPathInEditor(renderer, entry.filePath, kind, afterResume);
}
