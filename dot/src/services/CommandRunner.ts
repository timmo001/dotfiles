import type { CliRenderer } from "@opentui/core";
import { destroyRendererForCommand } from "./Renderer.js";
import type { NotifyConfig } from "../types.js";
import type { ToastService } from "./Toast.js";

const log = (msg: string) => console.error(`[dot:CommandRunner] ${msg}`);

async function runCaptured(cmd: string): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
}> {
  const proc = Bun.spawn(["bash", "-c", cmd], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stderr = exitCode === 0 ? "" : await new Response(proc.stderr).text();
  return { exitCode, stderr };
}

/** Service for executing shell commands with TUI suspend/resume lifecycle */
export interface CommandRunnerService {
  /** Suspend the TUI, run the command with inherited stdio, then resume.
   *  When wait is true, shows "Press any key to continue" before resuming. */
  readonly runSuspended: (cmd: string, wait: boolean) => Promise<void>;

  /** Run a command in the background without suspending the TUI.
   *  Returns immediately; stdout/stderr are captured silently. */
  readonly runSilent: (cmd: string) => Promise<void>;

  /** Run a command silently with toast notifications for progress and result. */
  readonly runNotify: (cmd: string, notify: NotifyConfig) => Promise<void>;

  /** Destroy the TUI, then run a command as a normal CLI process. */
  readonly exitAndRun: (cmd: string) => Promise<never>;
}

/** Create a {@link CommandRunnerService} bound to the given renderer for suspend/resume */
export function createCommandRunner(
  renderer: CliRenderer,
  toast: ToastService,
): CommandRunnerService {
  return {
    runSuspended: async (cmd, wait) => {
      log(`Suspending for: ${cmd}`);
      renderer.suspend();
      renderer.currentRenderBuffer.clear();

      try {
        const proc = Bun.spawn(["bash", "-c", cmd], {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        });
        await proc.exited;

        if (wait) {
          process.stdout.write("\n\x1b[90mPress any key to continue...\x1b[0m");
          await new Promise<void>((resolve) => {
            const wasRaw = process.stdin.isRaw;
            if (process.stdin.isTTY) process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.once("data", () => {
              if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
              process.stdin.pause();
              resolve();
            });
          });
        }
      } finally {
        renderer.currentRenderBuffer.clear();
        renderer.resume();
        renderer.requestRender();
        log("Resumed after command");
      }
    },

    runSilent: async (cmd) => {
      log(`Running silently: ${cmd}`);
      const { exitCode, stderr } = await runCaptured(cmd);

      if (exitCode !== 0) {
        log(`Silent command failed (exit ${exitCode}): ${stderr}`);
      } else {
        log(`Silent command completed: ${cmd}`);
      }
    },

    runNotify: async (cmd, notify) => {
      log(`Running with notification: ${cmd}`);
      toast.show(notify.id, notify.progress, "info");

      const { exitCode, stderr } = await runCaptured(cmd);

      if (exitCode !== 0) {
        const errMsg = stderr.trim().split("\n")[0] || "Command failed";
        log(`Notify command failed (exit ${exitCode}): ${stderr}`);
        toast.show(notify.id, errMsg, "error");
      } else {
        log(`Notify command completed: ${cmd}`);
        toast.show(notify.id, notify.success, "success");
      }
    },

    exitAndRun: async (cmd) => {
      log(`Exiting TUI for: ${cmd}`);
      renderer.currentRenderBuffer.clear();
      destroyRendererForCommand(renderer);

      const proc = Bun.spawn(["bash", "-c", cmd], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      process.exit(exitCode);
    },
  };
}
