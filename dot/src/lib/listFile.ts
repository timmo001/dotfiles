import { readFileSync } from "fs";

/**
 * Read a line-based list file, trimming each line and skipping blanks and
 * `#` comments. Returns `null` when the file cannot be read.
 */
export function readListFile(filePath: string): string[] | null {
  try {
    return readFileSync(filePath, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return null;
  }
}
