import { Effect, Schema } from "effect";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { displayPath } from "./omarchyHost.js";
import type { ConfigService } from "../services/Config.js";

/** Domain error for package setup failures. */
class PackageSetupError extends Schema.TaggedErrorClass<PackageSetupError>()(
  "PackageSetupError",
  {
    message: Schema.String,
  },
) {}

/** Arch package list scope handled by init. */
export type ArchPackageScope = "public" | "private";

function packageListPath(
  config: ConfigService,
  scope: ArchPackageScope,
): string | null {
  const pathForScope = {
    public: publicPackageListPath,
    private: privatePackageListPath,
  } satisfies Record<
    ArchPackageScope,
    (config: ConfigService) => string | null
  >;

  return pathForScope[scope](config);
}

function publicPackageListPath(config: ConfigService): string {
  return (
    process.env.DOT_PUBLIC_PACKAGES_FILE ??
    join(config.publicDotfiles, ".dot-public-packages")
  );
}

function privatePackageListPath(config: ConfigService): string | null {
  return (
    process.env.DOT_PRIVATE_PACKAGES_FILE ??
    (config.privateDotfiles
      ? join(config.privateDotfiles, ".dot-private-packages")
      : null)
  );
}

function loadPackageList(filePath: string): readonly string[] {
  return readFileSync(filePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function installedPackageCandidates(packageName: string): readonly string[] {
  return packageName === "go-automate-git"
    ? ["go-automate-git", "go-automate"]
    : [packageName];
}

const scopeLabel = (scope: ArchPackageScope): string =>
  scope === "public" ? "Public" : "Private";

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

function packageInstalled(
  packageName: string,
): Effect.Effect<boolean, never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    for (const candidate of installedPackageCandidates(packageName)) {
      if ((yield* executor.exitCode("pacman", ["-Q", candidate])) === 0) {
        return true;
      }
    }
    return false;
  });
}

function requirePackageListPath(
  config: ConfigService,
  scope: ArchPackageScope,
): Effect.Effect<string, PackageSetupError> {
  const filePath = packageListPath(config, scope);
  return filePath
    ? Effect.succeed(filePath)
    : fail(`Missing ${scope} package list path`);
}

function assertPackageListExists(
  scope: ArchPackageScope,
  filePath: string,
): Effect.Effect<void, PackageSetupError> {
  return existsSync(filePath)
    ? Effect.void
    : fail(`Missing ${scope} package list: ${displayPath(filePath)}`);
}

function missingFromPackageList(
  packages: readonly string[],
): Effect.Effect<readonly string[], never, CommandExecutor> {
  return Effect.gen(function* () {
    const missing: string[] = [];
    for (const packageName of packages) {
      if (!(yield* packageInstalled(packageName))) missing.push(packageName);
    }
    return missing;
  });
}

function missingPackages(
  config: ConfigService,
  scope: ArchPackageScope,
): Effect.Effect<readonly string[], PackageSetupError, CommandExecutor> {
  return Effect.gen(function* () {
    const filePath = yield* requirePackageListPath(config, scope);
    yield* assertPackageListExists(scope, filePath);
    return yield* missingFromPackageList(loadPackageList(filePath));
  });
}

function installStowPackage(): Effect.Effect<
  void,
  PackageSetupError,
  CommandExecutor | OutputLog
> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;

    if (!(yield* commandAvailable("omarchy-pkg-add"))) {
      return yield* fail(
        "Required command missing: omarchy-pkg-add (needed to install stow)",
      );
    }

    yield* log.info("Installing: stow");
    const exitCode = yield* executor.inherit("omarchy-pkg-add", ["stow"]);
    if (exitCode !== 0) {
      return yield* fail(`omarchy-pkg-add stow exited ${exitCode}`);
    }
  });
}

function assertCommandAvailable(
  command: string,
  message: string,
): Effect.Effect<void, PackageSetupError, CommandExecutor> {
  return Effect.gen(function* () {
    if (!(yield* commandAvailable(command))) return yield* fail(message);
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
    yield* log.info("stow is already installed");
    return;
  }

  yield* installStowPackage();
  yield* assertCommandAvailable(
    "stow",
    "stow is still unavailable after installation",
  );
});

function shouldSkipPackageScope(
  config: ConfigService,
  scope: ArchPackageScope,
): Effect.Effect<boolean, never, OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    if (scope === "private" && !config.canUsePrivate) {
      yield* log.warn(
        `Skipping private Arch packages (${config.privateReason})`,
      );
      return true;
    }
    return false;
  });
}

function installWithAurHelper(
  opts: {
    readonly scope: ArchPackageScope;
    readonly confirm?: boolean;
  },
  missing: readonly string[],
): Effect.Effect<void, PackageSetupError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;

    if (!(yield* commandAvailable("omarchy-pkg-aur-add"))) {
      return yield* fail(
        `Cannot install missing ${opts.scope} Arch packages (omarchy-pkg-aur-add not found): ${missing.join(" ")}`,
      );
    }

    yield* log.section(`Install ${opts.scope} Arch packages`);
    if (opts.confirm) {
      yield* log.warn("--confirm is ignored for omarchy-pkg-aur-add");
    }
    yield* log.info(`Installing: ${missing.join(" ")}`);
    const exitCode = yield* executor.inherit("omarchy-pkg-aur-add", missing);
    if (exitCode !== 0) {
      return yield* fail(
        `omarchy-pkg-aur-add ${missing.join(" ")} exited ${exitCode}`,
      );
    }
  });
}

/** Install missing Arch/AUR packages listed for the given scope. */
export function installMissingArchPackages(opts: {
  readonly scope: ArchPackageScope;
  readonly confirm?: boolean;
}): Effect.Effect<
  void,
  PackageSetupError,
  Config | CommandExecutor | OutputLog
> {
  return Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const label = scopeLabel(opts.scope);

    if (yield* shouldSkipPackageScope(config, opts.scope)) return;

    const missing = yield* missingPackages(config, opts.scope);
    if (missing.length === 0) {
      yield* log.info(`${label} Arch packages already installed`);
      return;
    }

    yield* installWithAurHelper(opts, missing);
  });
}
