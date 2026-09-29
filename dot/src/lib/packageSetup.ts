import { Effect, type FileSystem, Schema } from "effect";
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
} from "./archPackages.js";
import { resolvedOmarchyHost } from "./omarchyHost.js";
import { pathExists } from "./fsProbe.js";
import type { ConfigService } from "../services/Config.js";

/** Domain error for package setup failures. */
class PackageSetupError extends Schema.TaggedError<PackageSetupError>()(
  "PackageSetupError",
  {
    message: Schema.String,
  },
) {}

/** Arch package list scope handled by init. */
export type ArchPackageScope = "public" | "private";

const packageListPath = Effect.fn("PackageSetup.packageListPath")(function* (
  config: ConfigService,
  scope: ArchPackageScope,
) {
  return scope === "public"
    ? publicPackageListPath(config)
    : yield* privatePackageListPath(config);
});

function publicPackageListPath(config: ConfigService): string {
  return (
    envString(ENV.DOT_PUBLIC_PACKAGES_FILE) ??
    join(config.publicDotfiles, ".dot-public-packages")
  );
}

const privatePackageListPath = Effect.fn("PackageSetup.privatePackageListPath")(
  function* (config: ConfigService) {
    return (yield* privatePackageListPaths(config))[0] ?? null;
  },
);

const privatePackageListPaths = Effect.fn(
  "PackageSetup.privatePackageListPaths",
)(function* (
  config: ConfigService,
): Effect.fn.Return<readonly string[], never, FileSystem.FileSystem> {
  const override = envString(ENV.DOT_PRIVATE_PACKAGES_FILE);

  if (override) return [override];

  if (!config.privateDotfiles) return [];

  const base = join(config.privateDotfiles, ".dot-private-packages");
  const host = yield* resolvedOmarchyHost(config);

  return host ? [base, `${base}--${host}`] : [base];
});

const scopeLabel = (scope: ArchPackageScope): string =>
  scope === "public" ? "Public" : "Private";

/** Installed package replaced by the requested public package. */
export function replacedPublicPackage(packageName: string): string | undefined {
  return packageName === "mise-bin" ? "mise" : undefined;
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

const requirePackageListPath = Effect.fn("PackageSetup.requirePackageListPath")(
  function* (config: ConfigService, scope: ArchPackageScope) {
    const filePath = yield* packageListPath(config, scope);

    return filePath
      ? filePath
      : yield* fail(`Missing ${scope} package list path`);
  },
);

const assertPackageListExists = Effect.fn("PackageSetup.assertListExists")(
  function* (scope: ArchPackageScope, filePath: string) {
    if (!(yield* pathExists(filePath))) {
      return yield* fail(
        `Missing ${scope} package list: ${displayPath(filePath)}`,
      );
    }
  },
);

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
): Effect.Effect<
  readonly string[],
  PackageSetupError,
  CommandExecutor | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const filePath = yield* requirePackageListPath(config, scope);
    yield* assertPackageListExists(scope, filePath);

    const packages =
      scope === "private"
        ? loadPackageLists(yield* privatePackageListPaths(config))
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
    yield* log.info(cliStyler().dim("stow is already installed"));

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
    yield* log.info(cliStyler().dim("gum is already installed"));

    return;
  }

  yield* installWithOmarchyPkgAdd("gum", "interactive init questionnaire");
  yield* assertCommandAvailable(
    "gum",
    "gum is still unavailable after installation",
  );
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

  if (!(yield* commandAvailable("mise"))) {
    yield* installWithOmarchyPkgAdd("mise-bin", "tool version setup");
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

function installPublicPackageReplacements(
  missing: readonly string[],
): Effect.Effect<
  readonly string[],
  PackageSetupError,
  CommandExecutor | OutputLog
> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const log = yield* OutputLog;
    const remaining: string[] = [];

    for (const packageName of missing) {
      const replaced = replacedPublicPackage(packageName);

      if (
        !replaced ||
        (yield* executor.exitCode("pacman", ["-Q", replaced])) !== 0
      ) {
        remaining.push(packageName);
        continue;
      }

      yield* log.info(`Replacing ${replaced} with ${packageName}`);

      const exitCode = yield* runElevated("pacman", [
        "-S",
        "--needed",
        "--noconfirm",
        "--ask=4",
        packageName,
      ]);

      if (exitCode !== 0) {
        return yield* fail(
          `pacman -S ${packageName} exited ${exitCode}; cannot replace ${replaced}`,
        );
      }
    }

    return remaining;
  });
}

/** Install missing Arch/AUR packages listed for the given scope. */
export function installMissingArchPackages(opts: {
  readonly scope: ArchPackageScope;
}): Effect.Effect<
  void,
  PackageSetupError,
  Config | CommandExecutor | OutputLog | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const label = scopeLabel(opts.scope);

    if (yield* shouldSkipPackageScope(config, opts.scope)) return;

    const missing = yield* missingPackages(config, opts.scope);

    if (missing.length === 0) {
      yield* log.info(
        cliStyler().dim(`${label} Arch packages already installed`),
      );

      return;
    }

    if (opts.scope === "private") {
      yield* installWithPacman(opts, missing);
    } else {
      const remaining = yield* installPublicPackageReplacements(missing);

      if (remaining.length > 0) yield* installWithAurHelper(opts, remaining);
    }
  });
}
