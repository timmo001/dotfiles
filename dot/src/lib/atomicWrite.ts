import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { basename, dirname, join } from "path";

/** Options for {@link writeFileAtomic}. */
export interface AtomicWriteOptions {
  /** Exact permission bits for the written file, independent of umask. */
  readonly mode?: number;
  /** Create the parent directory first. */
  readonly createDirectory?: boolean;
}

/**
 * Replace a file so readers only ever see the old or the new content.
 *
 * Writes a uniquely named sibling temporary file, then renames it over the
 * target. The temporary file is removed if anything fails.
 */
export function writeFileAtomic(
  target: string,
  content: string,
  options: AtomicWriteOptions = {},
): void {
  const directory = dirname(target);

  if (options.createDirectory) mkdirSync(directory, { recursive: true });

  const temporary = join(directory, `.${basename(target)}.${randomUUID()}.tmp`);

  try {
    writeFileSync(temporary, content, { mode: options.mode, flag: "wx" });

    if (options.mode !== undefined) chmodSync(temporary, options.mode);

    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
