/**
 * @file Omarchy patches: check them against a pending Omarchy package before
 * `dot up` hands over to `omarchy update`, and keep the root-owned copy the
 * pacman hook runs in sync with the dotfiles.
 */

import { Effect, FileSystem } from "effect";
import { basename, join } from "path";
import { lines, query } from "./boundedQuery.js";
import { runElevated } from "./elevatedCommand.js";
import { ENV, envString } from "./env.js";
import { CACHE_DIR } from "./paths.js";
import { Config } from "../services/Config.js";

/** Where the pacman hook finds the patch script. */
const ROOT_SCRIPT = "/usr/local/bin/apply-omarchy-patches";

/** Root-owned patches, found by the script as `../share/omarchy-patches`. */
const ROOT_PATCHES = "/usr/local/share/omarchy-patches";

/** The installed pacman hook. */
const ROOT_HOOK = "/etc/pacman.d/hooks/omarchy-patches.hook";

const OMARCHY_PACKAGES = ["omarchy-dev", "omarchy"];

/** The patch script, patches and pacman hook in the public dotfiles. */
export const patchSources = (publicDotfiles: string) => ({
  script: join(
    publicDotfiles,
    "scripts",
    ".local",
    "bin",
    "apply-omarchy-patches",
  ),
  patches: join(
    publicDotfiles,
    "scripts",
    ".local",
    "share",
    "omarchy-patches",
  ),
  hook: join(
    publicDotfiles,
    "pacman-hooks",
    ".config",
    "pacman-hooks",
    "omarchy-patches.hook",
  ),
});

/** The sync database checkupdates keeps, so pacman can resolve pending versions without root. */
const checkupdatesDb = () =>
  `${envString(ENV.TMPDIR) ?? "/tmp"}/checkup-db-${process.getuid?.() ?? 0}/`;

/** The installed Omarchy package, or null when neither is installed. */
export const installedOmarchyPackage = Effect.fn("OmarchyPatches.installed")(
  function* (timeout: number) {
    const result = yield* query(
      "pacman",
      ["-Qq", ...OMARCHY_PACKAGES],
      timeout,
    );

    const installed = new Set(lines(result.stdout));

    return OMARCHY_PACKAGES.find((name) => installed.has(name)) ?? null;
  },
);

const patchFiles = Effect.fn("OmarchyPatches.files")(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;

  return (yield* fs.readDirectory(directory))
    .filter((name) => name.endsWith(".patch"))
    .sort();
});

/** Download the newest package into the cache, reusing it until the next version. */
const fetchPackage = Effect.fn("OmarchyPatches.fetchPackage")(function* (
  packageName: string,
  timeout: number,
) {
  const fs = yield* FileSystem.FileSystem;

  const resolved = yield* query(
    "pacman",
    ["-Sp", "--dbpath", checkupdatesDb(), packageName],
    timeout,
  );

  const location = lines(resolved.stdout).at(-1);

  if (resolved.code !== 0 || !location) return null;

  if (location.startsWith("file://")) {
    const path = location.slice("file://".length);

    if (yield* fs.exists(path)) return path;
  }

  const directory = join(CACHE_DIR, "dot", "omarchy-patch-check");
  const archive = join(directory, basename(location));

  yield* fs.makeDirectory(directory, { recursive: true });

  for (const name of yield* fs.readDirectory(directory)) {
    if (name !== basename(location))
      yield* fs.remove(join(directory, name), { force: true });
  }

  if (yield* fs.exists(archive)) return archive;

  if (location.startsWith("file://")) return null;

  const downloaded = yield* query(
    "curl",
    ["-fsSL", "-o", `${archive}.part`, location],
    timeout,
  );

  if (downloaded.code !== 0) return null;

  yield* fs.rename(`${archive}.part`, archive);

  return archive;
});

/** The patch drift check result: the package checked and the patches that no longer apply. */
export interface PatchDrift {
  /** Package archive the patches were checked against. */
  readonly archive: string;
  /** Patch file names that no longer apply. */
  readonly failing: readonly string[];
}

/**
 * Dry-run every patch against the files in the newest Omarchy package.
 * Returns null when the check couldn't run.
 */
export const patchDrift = Effect.fn("OmarchyPatches.drift")(
  function* (timeout: number) {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* Config;
    const sources = patchSources(config.publicDotfiles);
    const packageName = yield* installedOmarchyPackage(timeout);

    if (!packageName) return null;

    const archive = yield* fetchPackage(packageName, timeout);

    if (!archive) return null;

    const work = yield* fs.makeTempDirectoryScoped({
      prefix: "dot-omarchy-patches-",
    });

    const bin = join(work, "usr", "bin");
    const failing: string[] = [];

    for (const name of yield* patchFiles(sources.patches)) {
      const file = join(sources.patches, name);

      const target = /^\+\+\+ b\/bin\/(\S+)/m.exec(
        yield* fs.readFileString(file),
      )?.[1];

      const extracted = target
        ? yield* query(
            "bsdtar",
            ["-xf", archive, "-C", work, `usr/bin/${target}`],
            timeout,
          )
        : null;

      const applies =
        extracted?.code === 0 &&
        (yield* query(
          "patch",
          [
            "--batch",
            "--forward",
            "--fuzz=0",
            "--dry-run",
            "-d",
            bin,
            "-p2",
            "-i",
            file,
          ],
          timeout,
        )).code === 0;

      if (!applies) failing.push(name);
    }

    return { archive, failing } satisfies PatchDrift;
  },
  Effect.scoped,
  (effect) => effect.pipe(Effect.orElseSucceed(() => null)),
);

/** Whether the root-owned copy and the pacman hook match the dotfiles. */
const rootCopyCurrent = Effect.fn("OmarchyPatches.rootCopyCurrent")(
  function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* Config;
    const sources = patchSources(config.publicDotfiles);

    const same = (a: string, b: string) =>
      Effect.all([fs.readFileString(a), fs.readFileString(b)]).pipe(
        Effect.map(([left, right]) => left === right),
        Effect.orElseSucceed(() => false),
      );

    if (!(yield* same(sources.script, ROOT_SCRIPT))) return false;

    if (!(yield* same(sources.hook, ROOT_HOOK))) return false;

    const wanted = yield* patchFiles(sources.patches);

    const installed = yield* patchFiles(ROOT_PATCHES).pipe(
      Effect.orElseSucceed((): string[] => []),
    );

    if (wanted.join("\n") !== installed.join("\n")) return false;

    for (const name of wanted) {
      if (!(yield* same(join(sources.patches, name), join(ROOT_PATCHES, name))))
        return false;
    }

    return true;
  },
);

/**
 * Install the patch script, patches and pacman hook root-owned when they
 * differ from the dotfiles, so the hook never runs files the user can write,
 * then apply the patches to the installed Omarchy. Returns whether the copy
 * changed, or null when the install failed.
 */
export const syncRootPatches = Effect.fn("OmarchyPatches.syncRoot")(
  function* () {
    const config = yield* Config;
    const sources = patchSources(config.publicDotfiles);

    if (yield* rootCopyCurrent()) return false;

    const exitCode = yield* runElevated("sh", [
      "-c",
      `set -e
install -Dm755 "$1" ${ROOT_SCRIPT}
rm -rf ${ROOT_PATCHES}
install -Dm644 -t ${ROOT_PATCHES} "$2"/*.patch
install -Dm644 "$3" ${ROOT_HOOK}
${ROOT_SCRIPT}`,
      "sh",
      sources.script,
      sources.patches,
      sources.hook,
    ]);

    return exitCode === 0 ? true : null;
  },
);
