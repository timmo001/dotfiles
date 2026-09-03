import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "fs";
import { dirname, join } from "path";
import { STATE_DIR } from "./paths.js";

const LOCK_PATH = join(STATE_DIR, "dot", "workspace-mutation.lock");

/** Acquire the shared PID lock for commands that mutate Hyprland workspaces. */
export function acquireWorkspaceMutationLock(
  failure: (message: string) => Error,
  path = LOCK_PATH,
): string {
  mkdirSync(dirname(path), { recursive: true });
  const create = () => {
    const descriptor = openSync(path, "wx", 0o600);
    try {
      writeSync(descriptor, String(process.pid));
    } finally {
      closeSync(descriptor);
    }
  };

  try {
    create();
  } catch (initialError) {
    let active = true;
    try {
      const pid = Number(readFileSync(path, "utf8"));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid PID");
      process.kill(pid, 0);
    } catch {
      active = false;
    }
    if (active) throw failure("Another workspace mutation is already running");
    unlinkSync(path);
    try {
      create();
    } catch {
      throw failure(
        `Could not acquire workspace mutation lock: ${String(initialError)}`,
      );
    }
  }
  return path;
}

/** Release a shared workspace mutation lock. */
export function releaseWorkspaceMutationLock(path: string): void {
  rmSync(path, { force: true });
}
