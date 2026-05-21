import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, join } from "path";
import { setRenderLibPath } from "@opentui/core";

const DEBUG = !!process.env.DOT_DEBUG;
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
 * `~/.cache/dot/native-lib/` and calls {@link setRenderLibPath} so OpenTUI
 * loads it from the extracted location.
 *
 * No-op when running uncompiled (e.g. `bun run src/index.ts`).
 */
export async function extractNativeLibIfNeeded(): Promise<void> {
  if (!isCompiledBinary()) {
    log("Not a compiled binary, skipping native lib extraction");
    return;
  }

  log("Compiled binary detected, extracting native library...");

  const cacheDir = join(
    process.env.HOME ?? "/tmp",
    ".cache",
    "dot",
    "native-lib",
  );

  // Dynamically import the platform-specific native package to get the .so path.
  // In compiled mode, the "bun" export condition resolves to the bunfs-embedded path.
  let embeddedLibPath: string;
  try {
    const nativeModule = await import(
      `@opentui/core-${process.platform}-${process.arch}`
    );
    embeddedLibPath = nativeModule.default;
  } catch (e) {
    log(`Failed to resolve native package: ${e}`);
    return;
  }

  if (!isBunfsPath(embeddedLibPath)) {
    // Already a real filesystem path — just tell OpenTUI where it is
    log(`Library path is real filesystem: ${embeddedLibPath}`);
    setRenderLibPath(embeddedLibPath);
    return;
  }

  const libFileName = basename(embeddedLibPath);
  const destPath = join(cacheDir, libFileName);

  if (existsSync(destPath)) {
    log(`Using cached native library: ${destPath}`);
    setRenderLibPath(destPath);
    return;
  }

  // Clean old cached libraries before writing the new one
  try {
    if (existsSync(cacheDir)) {
      for (const f of readdirSync(cacheDir)) {
        if (f.startsWith("libopentui") && f.endsWith(".so") && f !== libFileName) {
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
  writeFileSync(destPath, libData, { mode: 0o755 });

  log(`Extracted native library (${libData.byteLength} bytes)`);
  setRenderLibPath(destPath);
}
