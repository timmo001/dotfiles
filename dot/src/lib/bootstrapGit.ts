import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";

/** Append-only logger used by pre-Effect init bootstrap helpers. */
export type BootstrapLog = (chunk: string | Uint8Array) => void;

function runBootstrapCommand(
  command: readonly string[],
  appendLog: BootstrapLog,
): number {
  appendLog(`\n$ ${command.join(" ")}\n`);

  const proc = Bun.spawnSync([...command], {
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });

  process.stdout.write(proc.stdout);
  process.stderr.write(proc.stderr);
  appendLog(proc.stdout);
  appendLog(proc.stderr);

  return proc.exitCode;
}

/** Pull an existing repository with rebase during pre-Effect bootstrap. */
export function bootstrapGitPullRebase(
  repoPath: string,
  appendLog: BootstrapLog,
): number {
  return runBootstrapCommand(
    ["git", "-C", repoPath, "pull", "--rebase"],
    appendLog,
  );
}

/** Create the parent directory of a bootstrap clone target. */
export function ensureBootstrapParent(repoPath: string): void {
  mkdirSync(dirname(repoPath), { recursive: true });
}

/** Return whether a path already contains a git checkout. */
export function bootstrapGitRepoExists(repoPath: string): boolean {
  return existsSync(join(repoPath, ".git"));
}
