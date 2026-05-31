import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

/** Return whether a path points at the GVfs FUSE mount used by desktop shares. */
export function isGvfsPath(path: string): boolean {
  return path.includes("/gvfs/");
}

function copyFile(command: readonly string[]): number {
  try {
    return Bun.spawnSync([...command], {
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode;
  } catch {
    return 127;
  }
}

/** Mirror the active init log to `DOT_LOG_MIRROR_FILE` when configured. */
export function mirrorConfiguredLog(): void {
  const source = process.env.DOT_LOG_FILE;
  const target = process.env.DOT_LOG_MIRROR_FILE;
  if (!source || !target || source === target) return;

  if (copyFile(["gio", "copy", "-f", source, target]) === 0) return;
  copyFile(["cp", source, target]);
}

/** Write a log chunk to a local file and mirror it to a configured export path. */
export function writeMirroredLog(
  logFile: string,
  chunk: string | Uint8Array,
  opts?: { readonly truncate?: boolean },
): void {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    if (opts?.truncate) {
      writeFileSync(logFile, chunk);
    } else {
      appendFileSync(logFile, chunk);
    }
    mirrorConfiguredLog();
  } catch (error) {
    process.stderr.write(
      `\n[WARN] Could not write init log: ${String(error)}\n`,
    );
  }
}
