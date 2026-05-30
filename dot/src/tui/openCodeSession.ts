import type { CliRenderer } from "@opentui/core";

/** Supported OpenCode launch modes. */
export type OpenCodeSessionMode = "default" | "plan";

/** Options for launching an interactive OpenCode session from the TUI. */
export interface OpenCodeSessionOptions {
  /** Which OpenCode agent mode to use. */
  readonly mode?: OpenCodeSessionMode;
  /** Optional prompt to pass to OpenCode; omit to launch a blank session. */
  readonly prompt?: string;
  /** Optional working directory for the OpenCode process. */
  readonly cwd?: string;
  /** Callback to run after the TUI resumes. */
  readonly afterResume?: () => void;
}

/** Suspend the TUI, launch an interactive OpenCode session, then resume. */
export async function openOpenCodeSession(
  renderer: CliRenderer,
  options: OpenCodeSessionOptions = {},
): Promise<void> {
  renderer.suspend();
  renderer.currentRenderBuffer.clear();

  try {
    const proc = Bun.spawn(openCodeArgs(options), {
      cwd: options.cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
  } finally {
    renderer.currentRenderBuffer.clear();
    renderer.resume();
    options.afterResume?.();
    renderer.requestRender();
  }
}

/** Human-readable label for an OpenCode session mode. */
export function openCodeSessionLabel(mode: OpenCodeSessionMode): string {
  return mode === "plan" ? "OpenCode plan" : "OpenCode";
}

function openCodeArgs(options: OpenCodeSessionOptions): string[] {
  const args =
    options.mode === "plan" ? ["opencode", "--agent", "plan"] : ["opencode"];
  if (options.prompt !== undefined) args.push("--prompt", options.prompt);
  return args;
}
