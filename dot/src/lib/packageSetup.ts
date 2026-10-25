import { Effect, type FileSystem, Schema } from "effect";
import { hostname } from "node:os";
import { cliStyler } from "./ansi.js";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { ENV, envString } from "./env.js";
import { loadPackageLists } from "./aptPackages.js";
import {
  type AppRequirements,
  appRequirementInstructions,
  hasMissingAppRequirements,
  missingAppRequirements,
  publicAppRequirements,
} from "./appOptions.js";
import type { ConfigService } from "../services/Config.js";

/** Domain error for package setup failures. */
class PackageSetupError extends Schema.TaggedError<PackageSetupError>()(
  "PackageSetupError",
  {
    message: Schema.String,
  },
) {}

/** Package list scope handled by init. */
export type PackageScope = "public" | "private";

/** Private Debian packages for the app's `system_packages` option. */
export function privateAppRequirements(config: ConfigService): AppRequirements {
  const override = envString(ENV.DOT_PRIVATE_PACKAGES_FILE);

  if (override) return { packages: loadPackageLists([override]), tools: [] };

  if (!config.privateDotfiles) return { packages: [], tools: [] };

  const base = join(config.privateDotfiles, ".dot-private-packages");

  return {
    packages: loadPackageLists([base, `${base}--${hostname()}`]),
    tools: [],
  };
}

/**
 * Ensure GNU Stow is installed before dotfiles can be linked. The app installs
 * it from its `system_packages` option, so a missing one stops here.
 */
export const ensureStowInstalled: Effect.Effect<
  void,
  PackageSetupError,
  CommandExecutor | OutputLog
> = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  yield* log.section("Setup Prerequisites");

  if ((yield* executor.exitCode("which", ["stow"])) === 0) {
    yield* log.info(cliStyler().dim("stow is already installed"));

    return;
  }

  return yield* new PackageSetupError({
    message:
      "stow isn't installed. Add stow to the app's system_packages option, then restart the app",
  });
});

/**
 * Check the app's options provide the packages and tools listed for the given
 * scope, and say what to add when they don't. dot never installs them itself:
 * the app does, from its options, on start.
 */
export function checkAppRequirements(opts: {
  readonly scope: PackageScope;
}): Effect.Effect<
  void,
  never,
  Config | CommandExecutor | OutputLog | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const label = opts.scope === "public" ? "Public" : "Private";

    if (opts.scope === "private" && !config.canUsePrivate) {
      yield* log.warn(`Skipping private packages (${config.privateReason})`);

      return;
    }

    const requirements =
      opts.scope === "public"
        ? publicAppRequirements(config)
        : privateAppRequirements(config);

    if (requirements.packages.length === 0 && requirements.tools.length === 0) {
      yield* log.info(cliStyler().dim(`No ${opts.scope} packages or tools`));

      return;
    }

    const missing = yield* missingAppRequirements(requirements).pipe(
      Effect.catchTag("AppOptionsError", (error) =>
        log.warn(error.message).pipe(Effect.as(null)),
      ),
    );

    if (missing === null) return;

    if (!hasMissingAppRequirements(missing)) {
      yield* log.info(
        cliStyler().dim(`${label} packages and tools come from the app`),
      );

      return;
    }

    for (const line of appRequirementInstructions(missing)) {
      yield* log.warn(line);
    }
  });
}
