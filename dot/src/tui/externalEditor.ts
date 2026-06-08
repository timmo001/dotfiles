import type { CliRenderer } from "@opentui/core";
import { ENV, envString } from "../lib/env.js";

/** Supported external editor launch modes. */
export type ExternalEditorKind = "editor" | "visual";

/** Launch mode that should start the external editor detached from the TUI. */
export function editorLaunchesDetached(kind: ExternalEditorKind): boolean {
  return kind === "visual";
}

/** Launch a path in an external editor. Editor mode waits; visual mode detaches. */
export async function openPathInEditor(
  renderer: CliRenderer,
  path: string,
  kind: ExternalEditorKind,
  afterResume?: () => void,
): Promise<void> {
  const command = editorCommand(path, kind);

  if (editorLaunchesDetached(kind)) {
    launchDetached(command);
    return;
  }

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

/** Suspend the TUI, launch the terminal editor in a working directory, then resume. */
export async function openEditorInDirectory(
  renderer: CliRenderer,
  cwd: string,
  afterResume?: () => void,
): Promise<void> {
  const command = resolveEditorCommand("editor");
  renderer.suspend();
  renderer.currentRenderBuffer.clear();

  try {
    const proc = Bun.spawn(["bash", "-lc", command], {
      cwd,
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
  return kind === "visual"
    ? firstNonEmpty(envString(ENV.VISUAL), envString(ENV.EDITOR), "nvim")
    : firstNonEmpty(envString(ENV.EDITOR), "nvim");
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string {
  return (
    values.find((value) => value && value.trim().length > 0)?.trim() ?? "nvim"
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function launchDetached(command: string): void {
  const proc = Bun.spawn(["bash", "-lc", command], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  });
  proc.unref();
}
