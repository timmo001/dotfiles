import { Effect, Schema } from "effect";
import { existsSync } from "fs";
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
} from "./archPackages.js";
import { resolvedOmarchyHost } from "./omarchyHost.js";
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
    envString(ENV.DOT_PUBLIC_PACKAGES_FILE) ??
    join(config.publicDotfiles, ".dot-public-packages")
  );
}

function privatePackageListPath(config: ConfigService): string | null {
  return privatePackageListPaths(config)[0] ?? null;
}

function privatePackageListPaths(config: ConfigService): readonly string[] {
  const override = envString(ENV.DOT_PRIVATE_PACKAGES_FILE);
  if (override) return [override];
  if (!config.privateDotfiles) return [];

  const base = join(config.privateDotfiles, ".dot-private-packages");
  const host = resolvedOmarchyHost(config);
  return host ? [base, `${base}--${host}`] : [base];
}

/**
 * Public AUR packages that conflict with an official-repo package which must be
 * removed first. The AUR helper runs `yay -S --noconfirm`, and pacman only
 * auto-removes a conflict when the new package `Replaces` the old one; these do
 * not, so a non-interactive install aborts on the conflict prompt unless the
 * official package is removed beforehand.
 */
const conflictingOfficialPackage: Readonly<Record<string, string>> = {
  // mise-bin (AUR, current) replaces the stale extra/mise base package.
  "mise-bin": "mise",
};

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
      if (!(yield* isPackageInstalled(packageName))) missing.push(packageName);
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
    const packages =
      scope === "private"
        ? loadPackageLists(privatePackageListPaths(config))
        : loadPackageList(filePath);
    return yield* missingFromPackageList(packages);
  });
}

function installWithOmarchyPkgAdd(
  packageName: string,
  reason: string,
): Effect.Effect<void, PackageSetupError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;

    if (!(yield* commandAvailable("omarchy-pkg-add"))) {
      return yield* fail(
        `Required command missing: omarchy-pkg-add (needed to install ${packageName} for ${reason})`,
      );
    }

    yield* log.info(`Installing: ${packageName}`);
    const exitCode = yield* executor.inherit("omarchy-pkg-add", [packageName]);
    if (exitCode !== 0) {
      return yield* fail(`omarchy-pkg-add ${packageName} exited ${exitCode}`);
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

  yield* installWithOmarchyPkgAdd("stow", "dotfile linking");
  yield* assertCommandAvailable(
    "stow",
    "stow is still unavailable after installation",
  );
});

/** Ensure gum is installed before interactive init prompts run. */
export const ensureGumInstalled: Effect.Effect<
  void,
  PackageSetupError,
  CommandExecutor | OutputLog
> = Effect.gen(function* () {
  const log = yield* OutputLog;

  yield* log.section("Init Questionnaire Prerequisites");

  if (yield* commandAvailable("gum")) {
    yield* log.info("gum is already installed");
    return;
  }

  yield* installWithOmarchyPkgAdd("gum", "interactive init questionnaire");
  yield* assertCommandAvailable(
    "gum",
    "gum is still unavailable after installation",
  );
});

function miseConfigExists(): boolean {
  return [
    envString(ENV.MISE_GLOBAL_CONFIG_FILE),
    join(CONFIG_DIR, "mise", "config.toml"),
    join(CONFIG_DIR, "mise", "config.json"),
    join(HOME_DIR, ".mise.toml"),
    join(HOME_DIR, ".tool-versions"),
  ].some((filePath) => filePath !== undefined && existsSync(filePath));
}

/** Ensure mise is installed and install stowed mise-managed tool versions. */
export const installMiseTools: Effect.Effect<
  void,
  PackageSetupError,
  CommandExecutor | OutputLog
> = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  yield* log.section("Install Mise Tools");

  if (!miseConfigExists()) {
    yield* log.info("No mise config found; skipping mise install");
    return;
  }

  if (!(yield* commandAvailable("mise"))) {
    yield* installWithOmarchyPkgAdd("mise", "tool version setup");
  }

  yield* assertCommandAvailable(
    "mise",
    "mise is still unavailable after installation",
  );

  const exitCode = yield* executor.inherit("mise", ["install"], {
    cwd: HOME_DIR,
  });
  if (exitCode !== 0) {
    return yield* fail(`mise install exited ${exitCode}`);
  }
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

function installWithPacman(
  opts: {
    readonly scope: ArchPackageScope;
    readonly confirm?: boolean;
  },
  missing: readonly string[],
): Effect.Effect<void, PackageSetupError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;

    yield* log.section(`Install ${opts.scope} Arch packages`);
    yield* log.info(`Installing: ${missing.join(" ")}`);
    const exitCode = yield* runElevated("pacman", [
      "-Sy",
      "--needed",
      "--noconfirm",
      ...missing,
    ]);
    if (exitCode !== 0) {
      return yield* fail(`pacman -Sy ${missing.join(" ")} exited ${exitCode}`);
    }
  });
}

/**
 * Remove official-repo packages that block a non-interactive AUR install of a
 * conflicting replacement (see {@link conflictingOfficialPackage}). Skips any
 * package whose official counterpart is not installed, so it is idempotent.
 */
function replaceConflictingOfficialPackages(
  missing: readonly string[],
): Effect.Effect<void, PackageSetupError, CommandExecutor | OutputLog> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;

    for (const packageName of missing) {
      const official = conflictingOfficialPackage[packageName];
      if (!official) continue;
      if ((yield* executor.exitCode("pacman", ["-Q", official])) !== 0) {
        continue;
      }

      yield* log.info(
        `Removing ${official} (conflicts with ${packageName}) before install`,
      );
      const exitCode = yield* runElevated("pacman", [
        "-Rdd",
        "--noconfirm",
        official,
      ]);
      if (exitCode !== 0) {
        return yield* fail(
          `pacman -Rdd ${official} exited ${exitCode}; cannot install ${packageName}`,
        );
      }
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

    if (opts.scope === "private") {
      yield* installWithPacman(opts, missing);
    } else {
      yield* replaceConflictingOfficialPackages(missing);
      yield* installWithAurHelper(opts, missing);
    }
  });
}
