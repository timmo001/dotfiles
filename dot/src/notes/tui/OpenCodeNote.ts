import type { CliRenderer } from "@opentui/core";
import type { NoteEntry } from "../types.js";
import {
  openOpenCodeSession,
  type OpenCodeSessionMode,
} from "../../tui/openCodeSession.js";

/** Supported OpenCode launch modes for repository notes. */
export type OpenCodeNoteMode = OpenCodeSessionMode;

/** Options for launching OpenCode from the notes TUI. */
export interface OpenNoteInOpenCodeOptions {
  /** Which OpenCode agent mode to use. */
  readonly mode?: OpenCodeNoteMode;
  /** Callback to run after the TUI resumes. */
  readonly afterResume?: () => void;
}

/** Suspend the TUI, launch a full OpenCode session for a note, then resume. */
export async function openNoteInOpenCode(
  renderer: CliRenderer,
  entry: NoteEntry,
  noteContent: string,
  options: OpenNoteInOpenCodeOptions = {},
): Promise<void> {
  const mode = options.mode ?? "default";
  await openOpenCodeSession(renderer, {
    mode,
    prompt: opencodeNotePrompt(entry, noteContent, mode),
    afterResume: options.afterResume,
  });
}

function opencodeNotePrompt(
  entry: NoteEntry,
  noteContent: string,
  mode: OpenCodeNoteMode,
): string {
  const displayPath = repoNotesDisplayPath(entry);
  return [
    `Use the repository note ${entry.filename} included below as loaded context for this OpenCode session, following the note-reference next-step flow.`,
    `The note file path is ${entry.filePath}.`,
    ...(mode === "plan"
      ? [
          "",
          "This OpenCode process was launched with --agent plan. You are already running inside the plan agent.",
          "After loading the note and relevant skills, present an execution-ready plan directly. Do not suggest entering /plan and do not stop at a single next action.",
          "If the note does not contain enough detail for a safe plan, automatically gather the missing repository context with read-only tools first, then present the plan. If the plan is still blocked after gathering context, state exactly what remains missing.",
        ]
      : []),
    "",
    "Step 1: Keep the full loaded note content below in context for this session. Do not call dot_note_read just to load this note; the dot TUI already supplied it.",
    "Keep the full note content in context for this session.",
    "",
    `----- BEGIN LOADED NOTE: ${displayPath} -----`,
    noteContent.length > 0 ? noteContent : "(empty note)",
    `----- END LOADED NOTE: ${displayPath} -----`,
    "",
    "Step 2: Inspect the loaded note content for explicit skill names or clearly required skill workflows. Load each relevant skill with the skill tool before presenting next steps.",
    "Prefer skills explicitly listed in note sections such as Skills, Applicable Skills, Required Skills, Workflow, or Next Steps.",
    "Also load a skill when the note clearly maps to a known skill trigger, such as a handoff, TypeScript work, OpenCode config, dotfiles stow maintenance, frontend debugging, or architecture review.",
    "Do not invent skill names. If no relevant skill is explicit or clearly triggered, skip skill loading silently.",
    "",
    ...(mode === "plan"
      ? [
          "Step 3: Treat this as planning context. Present a complete implementation plan for resuming from the loaded note.",
          "Do not make changes unless the user explicitly asks to implement, fix, edit, run, or otherwise make a change.",
        ]
      : [
          "Step 3: Treat this as read-only context loading unless the user's follow-up explicitly asks to implement, fix, edit, run, or otherwise make a change.",
          "Present the immediate next step only:",
          "- If the loaded note is a plan, suggest entering plan mode with /plan to finalise it before implementation.",
          "- If already running inside the plan agent, do not suggest plan mode; instead finalise the plan directly and get it ready for execution.",
          "- If the loaded note is research, suggest the next research, validation, or implementation step implied by the note.",
          "- If the note is a handoff, suggest the single next action needed to resume from the handoff.",
        ]),
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
