import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, join } from "path";
import { CACHE_DIR } from "./paths.js";
import { ENV, envString } from "./env.js";
import { formatCause } from "./schema.js";

const DEBUG = !!envString(ENV.DOT_DEBUG);
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:extractNativeLib] ${msg}`);
};

/** Bunfs root path where Bun embeds assets in compiled binaries. */
const BUNFS_ROOT = "/$bunfs/root";

/**
 * Detect whether the process is running from a `bun build --compile` binary.
 */
function isCompiledBinary(): boolean {
  return (
    import.meta.path.includes("$bunfs") ||
    import.meta.path.startsWith(BUNFS_ROOT)
  );
}

/**
 * Check whether a path is inside the Bun virtual filesystem.
 */
function isBunfsPath(path: string): boolean {
  return path.includes("$bunfs") || path.startsWith(BUNFS_ROOT);
}

/**
 * Extract the OpenTUI native `.so` from Bun's embedded virtual filesystem
 * to a real path on disk so that `dlopen()` can load it.
 *
 * In compiled binaries, native libraries are embedded in `/$bunfs/root/` which
 * is accessible to Bun's runtime APIs (`readFileSync`, `Bun.file`) but not to
 * the kernel's `dlopen()` syscall. This function copies the library to
 * `~/.cache/dot/native-lib/` and returns the extracted path.
 *
 * The caller should pass the returned path to `setRenderLibPath()` from
 * `@opentui/core` before creating the renderer.
 *
 * Returns `undefined` when running uncompiled (e.g. `bun run src/index.ts`)
 * or if extraction fails.
 */
export async function extractNativeLibIfNeeded(): Promise<string | undefined> {
  if (!isCompiledBinary()) {
    log("Not a compiled binary, skipping native lib extraction");
    return undefined;
  }

  log("Compiled binary detected, extracting native library...");

  const cacheDir = join(CACHE_DIR, "dot", "native-lib");

  // Dynamically import the platform-specific native package to get the .so path.
  // In compiled mode, the "bun" export condition resolves to the bunfs-embedded path.
  let embeddedLibPath: string;
  try {
    const nativeModule = await import(
      `@opentui/core-${process.platform}-${process.arch}`
    );
    embeddedLibPath = nativeModule.default;
  } catch (e) {
    log(`Failed to resolve native package: ${formatCause(e)}`);
    return undefined;
  }

  if (!isBunfsPath(embeddedLibPath)) {
    // Already a real filesystem path — caller can use it directly
    log(`Library path is real filesystem: ${embeddedLibPath}`);
    return embeddedLibPath;
  }

  const libFileName = basename(embeddedLibPath);
  const destPath = join(cacheDir, libFileName);

  if (existsSync(destPath)) {
    log(`Using cached native library: ${destPath}`);
    return destPath;
  }

  // Clean old cached libraries before writing the new one
  try {
    if (existsSync(cacheDir)) {
      for (const f of readdirSync(cacheDir)) {
        if (
          f.startsWith("libopentui") &&
          f.endsWith(".so") &&
          f !== libFileName
        ) {
          log(`Removing stale cached library: ${f}`);
          unlinkSync(join(cacheDir, f));
        }
      }
    }
  } catch {
    // Non-fatal — old files can stay
  }

  log(`Extracting ${embeddedLibPath} → ${destPath}`);
  mkdirSync(cacheDir, { recursive: true });

  // Read from Bun's virtual filesystem (Bun handles /$bunfs/ transparently)
  const libData = readFileSync(embeddedLibPath);
  // Write to a unique temp path then atomically rename into place, so a second
  // `dot` starting concurrently can never observe (and dlopen) a half-written
  // library at destPath.
  const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, libData, { mode: 0o755 });
    renameSync(tmpPath, destPath);
  } catch (e) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup of the temp file.
    }
    throw e;
  }

  log(`Extracted native library (${libData.byteLength} bytes)`);
  return destPath;
}
