import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";

/** Append-only logger used by pre-Effect init bootstrap helpers. */
export type BootstrapLog = (chunk: string | Uint8Array) => void;

function commandExitCode(command: readonly string[]): number {
  try {
    return Bun.spawnSync([...command], {
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode;
  } catch {
    return 127;
  }
}

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

/** Return whether the GitHub CLI has usable authentication. */
export function ghAuthenticated(): boolean {
  return commandExitCode(["gh", "auth", "status"]) === 0;
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

/** Clone a GitHub repository with `gh repo clone` during pre-Effect bootstrap. */
export function bootstrapGhRepoClone(
  remote: string,
  repoPath: string,
  appendLog: BootstrapLog,
): number {
  mkdirSync(dirname(repoPath), { recursive: true });
  return runBootstrapCommand(
    ["gh", "repo", "clone", remote, repoPath],
    appendLog,
  );
}

/** Return whether a path already contains a git checkout. */
export function bootstrapGitRepoExists(repoPath: string): boolean {
  return existsSync(join(repoPath, ".git"));
}
