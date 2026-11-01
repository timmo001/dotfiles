import { Effect, type FileSystem, Schema } from "effect";
import { hostname } from "node:os";
import { cliStyler } from "./ansi.js";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { CONFIG_DIR, HOME_DIR, displayPath } from "./paths.js";
import { runElevated } from "./elevatedCommand.js";
import { ENV, envString } from "./env.js";
import {
  isPackageInstalled,
  loadPackageList,
  loadPackageLists,
} from "./aptPackages.js";
import { pathExists } from "./fsProbe.js";
import type { ConfigService } from "../services/Config.js";

/** Domain error for package setup failures. */
class PackageSetupError extends Schema.TaggedError<PackageSetupError>()(
  "PackageSetupError",
  {
    message: Schema.String,
  },
) {}

/** Apt package list scope handled by init. */
export type PackageScope = "public" | "private";

function publicPackageListPath(config: ConfigService): string {
  return (
    envString(ENV.DOT_PUBLIC_PACKAGES_FILE) ??
    join(config.publicDotfiles, ".dot-public-packages")
  );
}

function privatePackageListPaths(config: ConfigService): readonly string[] {
  const override = envString(ENV.DOT_PRIVATE_PACKAGES_FILE);

  if (override) return [override];

  if (!config.privateDotfiles) return [];

  const base = join(config.privateDotfiles, ".dot-private-packages");

  return [base, `${base}--${hostname()}`];
}

function fail(message: string): Effect.Effect<never, PackageSetupError> {
  return Effect.fail(new PackageSetupError({ message }));
}

function commandAvailable(
  command: string,
): Effect.Effect<boolean, never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    return (yield* executor.exitCode("which", [command])) === 0;
  });
}

function missingPackages(
  config: ConfigService,
  scope: PackageScope,
): Effect.Effect<
  readonly string[],
  PackageSetupError,
  CommandExecutor | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const filePath =
      scope === "public"
        ? publicPackageListPath(config)
        : privatePackageListPaths(config)[0];

    if (!filePath) return yield* fail(`Missing ${scope} package list path`);

    if (!(yield* pathExists(filePath))) {
      return yield* fail(
        `Missing ${scope} package list: ${displayPath(filePath)}`,
      );
    }

    const packages =
      scope === "private"
        ? loadPackageLists(privatePackageListPaths(config))
        : loadPackageList(filePath);

    const missing: string[] = [];

    for (const packageName of packages) {
      if (!(yield* isPackageInstalled(packageName))) missing.push(packageName);
    }

    return missing;
  });
}

/**
 * Packages in a scope's list that aren't installed. Empty when the private
 * overlay is unavailable; null when the list can't be read.
 */
export const missingListedPackages = Effect.fn("PackageSetup.missing")(
  function* (scope: PackageScope) {
    const config = yield* Config;

    if (scope === "private" && !config.canUsePrivate) return [];

    return yield* missingPackages(config, scope).pipe(
      Effect.orElseSucceed(() => null),
    );
  },
);

function installWithApt(
  packages: readonly string[],
): Effect.Effect<void, PackageSetupError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;

    yield* log.info(`Installing: ${packages.join(" ")}`);

    const exitCode = yield* runElevated("apt-get", [
      "install",
      "-y",
      "--no-install-recommends",
      ...packages,
    ]);

    if (exitCode !== 0) {
      return yield* fail(
        `apt-get install ${packages.join(" ")} exited ${exitCode}`,
      );
    }
  });
}

function ensureCommand(
  command: string,
  packageName: string,
): Effect.Effect<void, PackageSetupError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    if (yield* commandAvailable(command)) return;

    yield* installWithApt([packageName]);

    if (!(yield* commandAvailable(command)))
      return yield* fail(`${command} is still unavailable after installation`);
  });
}

/** Ensure GNU Stow is installed before dotfiles can be linked. */
export const ensureStowInstalled: Effect.Effect<
  void,
  PackageSetupError,
  CommandExecutor | OutputLog
> = Effect.gen(function* () {
  const log = yield* OutputLog;

  yield* log.section("Setup Prerequisites");

  if (yield* commandAvailable("stow")) {
    yield* log.info(cliStyler().dim("stow is already installed"));

    return;
  }

  yield* ensureCommand("stow", "stow");
});

const miseConfigExists = Effect.fn("PackageSetup.miseConfigExists")(
  function* () {
    for (const filePath of [
      envString(ENV.MISE_GLOBAL_CONFIG_FILE),
      join(CONFIG_DIR, "mise", "config.toml"),
      join(CONFIG_DIR, "mise", "config.json"),
      join(HOME_DIR, ".mise.toml"),
      join(HOME_DIR, ".tool-versions"),
    ]) {
      if (filePath !== undefined && (yield* pathExists(filePath))) return true;
    }

    return false;
  },
);

/** Ensure mise is installed and install stowed mise-managed tool versions. */
export const installMiseTools: Effect.Effect<
  void,
  PackageSetupError,
  CommandExecutor | OutputLog | FileSystem.FileSystem
> = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  yield* log.section("Install Mise Tools");

  if (!(yield* miseConfigExists())) {
    yield* log.info(
      cliStyler().dim("No mise config found; skipping mise install"),
    );

    return;
  }

  yield* ensureCommand("mise", "mise");

  const exitCode = yield* executor.inherit("mise", ["install"], {
    cwd: HOME_DIR,
  });

  if (exitCode !== 0) {
    return yield* fail(`mise install exited ${exitCode}`);
  }
});

/** Install missing apt packages listed for the given scope. */
export function installMissingPackages(opts: {
  readonly scope: PackageScope;
}): Effect.Effect<
  void,
  PackageSetupError,
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

    const missing = yield* missingPackages(config, opts.scope);

    if (missing.length === 0) {
      yield* log.info(cliStyler().dim(`${label} packages already installed`));

      return;
    }

    yield* log.section(`Install ${opts.scope} packages`);
    yield* installWithApt(missing);
  });
}
