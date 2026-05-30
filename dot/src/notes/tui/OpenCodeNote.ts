import type { CliRenderer } from "@opentui/core";
import type { NoteEntry } from "../types.js";

/** Suspend the TUI, launch a full OpenCode session for a note, then resume. */
export async function openNoteInOpenCode(
  renderer: CliRenderer,
  entry: NoteEntry,
  afterResume?: () => void,
): Promise<void> {
  renderer.suspend();
  renderer.currentRenderBuffer.clear();
  try {
    const proc = Bun.spawn(
      ["opencode", "--prompt", opencodeNotePrompt(entry)],
      {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    await proc.exited;
  } finally {
    renderer.currentRenderBuffer.clear();
    renderer.resume();
    afterResume?.();
    renderer.requestRender();
  }
}

function opencodeNotePrompt(entry: NoteEntry): string {
  const displayPath = repoNotesDisplayPath(entry);
  return [
    `Load the repository note ${entry.filename} into this OpenCode session, following the note-reference flow.`,
    `The note file path is ${entry.filePath}.`,
    "",
    "Step 1: Use the note_read tool first to read that exact file. Do not use built-in read, bash, or other filesystem tools for the notes vault.",
    "Keep the full note content in context for this session.",
    "",
    "Step 2: Inspect the loaded note content for explicit skill names or clearly required skill workflows. Load each relevant skill with the skill tool before presenting next steps.",
    "Prefer skills explicitly listed in note sections such as Skills, Applicable Skills, Required Skills, Workflow, or Next Steps.",
    "Also load a skill when the note clearly maps to a known skill trigger, such as a handoff, TypeScript work, OpenCode config, dotfiles stow maintenance, frontend debugging, or architecture review.",
    "Do not invent skill names. If no relevant skill is explicit or clearly triggered, skip skill loading silently.",
    "",
    "Step 3: Treat this as read-only context loading unless the user's follow-up explicitly asks to implement, fix, edit, run, or otherwise make a change.",
    "Present the immediate next step only:",
    "- If the loaded note is a plan, suggest entering plan mode with /plan to finalise it before implementation.",
    "- If already running inside the plan agent, do not suggest plan mode; instead finalise the plan directly and get it ready for execution.",
    "- If the loaded note is research, suggest the next research, validation, or implementation step implied by the note.",
    "- If the note is a handoff, suggest the single next action needed to resume from the handoff.",
    "",
    "Confirm exactly:",
    `Loaded: ${displayPath}`,
    "",
    "The content is now in context. Answer follow-up questions about it directly, but do not make changes unless the user explicitly asks for them.",
  ].join("\n");
}

function repoNotesDisplayPath(entry: NoteEntry): string {
  const marker = "/repo-notes/";
  const normalized = entry.filePath.replaceAll("\\", "/");
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex === -1) return entry.filename;
  return `repo-notes/${normalized.slice(markerIndex + marker.length)}`;
}
