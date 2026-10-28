import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { cliStyler } from "./ansi.js";
import { writeFileAtomic } from "./atomicWrite.js";
import { HOME_DIR, displayPath, expandHomePath } from "./paths.js";
import { plural } from "./runSummary.js";
import { done, skip, warn } from "./updateSummary.js";
import type { RecapEntry } from "./updateSummary.js";

/** Native messaging host name the dot links extension connects to. */
export const DOT_LINKS_HOST_NAME = "dev.timmo.dot_links";

/** Extension ID, fixed by the `key` in `chromium-extension/manifest.json`. */
export const DOT_LINKS_EXTENSION_ID = "gpoammoojdfocbjjmlkoklijfiflmpic";

/** Stowed wrapper that runs `dot link native-host`; Chromium can't pass it arguments. */
export const DOT_LINKS_HOST_PATH = join(
  HOME_DIR,
  ".local",
  "bin",
  "link-native-host",
);

/** The native messaging host manifest for one browser user data directory. */
export const dotLinksHostManifestPath = (userDataDir: string) =>
  join(
    expandHomePath(userDataDir),
    "NativeMessagingHosts",
    `${DOT_LINKS_HOST_NAME}.json`,
  );

/** Content of the native messaging host manifest. */
export const dotLinksHostManifest = () =>
  `${JSON.stringify(
    {
      name: DOT_LINKS_HOST_NAME,
      description: "Open GitHub issues and pull requests in the Git panel",
      path: DOT_LINKS_HOST_PATH,
      type: "stdio",
      allowed_origins: [`chrome-extension://${DOT_LINKS_EXTENSION_ID}/`],
    },
    null,
    2,
  )}\n`;

/** Failure to build the extension or write a host manifest. */
class DotLinksExtensionError extends Schema.TaggedError<DotLinksExtensionError>()(
  "DotLinksExtensionError",
  { message: Schema.String },
) {}

/**
 * Bundle the dot links Chromium extension and write its native messaging host
 * manifest into each browser in `links.extension.user_data_dirs`.
 *
 * @returns Recap entries for the stow summary. Failures become a warning so
 *   the rest of stow carries on.
 */
export const applyDotLinksExtension = Effect.gen(function* () {
  const config = yield* Config;
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;
  const style = cliStyler();

  const userDataDirs = config.gitConfig.links?.extension?.user_data_dirs ?? [];

  if (userDataDirs.length === 0)
    return [skip("dot links extension not configured")];

  yield* log.section("dot links Extension");

  yield* executor
    .run(
      "bun",
      [
        "build",
        "src/background.ts",
        "src/popup.ts",
        "--target=browser",
        "--format=iife",
        "--outdir=dist",
      ],
      { cwd: join(config.publicDotfiles, "chromium-extension") },
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new DotLinksExtensionError({
            message: `bundle: ${cause.stderr || `${cause.command} exited ${cause.exitCode}`}`,
          }),
      ),
    );

  yield* log.success("Bundled the extension");

  const manifest = dotLinksHostManifest();

  for (const dir of userDataDirs) {
    const target = dotLinksHostManifestPath(dir);

    if (!(yield* fs.exists(expandHomePath(dir)))) {
      yield* log.warn(`Browser data not found: ${displayPath(dir)}`);
      continue;
    }

    yield* Effect.try({
      try: () => writeFileAtomic(target, manifest, { createDirectory: true }),
      catch: (cause) =>
        new DotLinksExtensionError({
          message: `write ${displayPath(target)}: ${String(cause)}`,
        }),
    });

    yield* log.success(`Wrote ${style.dim(displayPath(target))}`);
  }

  return [
    done(
      `Set up the dot links extension for ${plural(userDataDirs.length, "browser")}`,
    ),
  ];
}).pipe(
  Effect.catch((error) =>
    Effect.gen(function* () {
      const log = yield* OutputLog;

      yield* log.warn(`dot links extension not set up: ${error.message}`);

      return [warn("dot links extension not set up")] satisfies RecapEntry[];
    }),
  ),
  Effect.withSpan("DotLinksExtension.apply"),
);
