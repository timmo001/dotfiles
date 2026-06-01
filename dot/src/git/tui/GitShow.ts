import type { CliRenderer } from "@opentui/core";
import { runSuspendedCommand } from "./SuspendedCommand.js";

/** Suspend the TUI, show a commit patch through git's pager, then resume rendering. */
export async function openGitShow(
  renderer: CliRenderer,
  repoPath: string,
  sha: string,
  afterResume?: () => void,
): Promise<void> {
  await runSuspendedCommand({
    renderer,
    command: ["git", "--paginate", "show", "--stat", "--patch", sha],
    cwd: repoPath,
    afterResume,
  });
}
