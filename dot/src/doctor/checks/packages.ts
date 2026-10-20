import { Effect } from "effect";
import { hostname } from "node:os";
import { join } from "path";
import { pathExists } from "../../lib/fsProbe.js";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { displayPath } from "../../lib/paths.js";
import { ENV, envString } from "../../lib/env.js";
import {
  isPackageInstalled,
  loadPackageList,
  loadPackageLists,
} from "../../lib/aptPackages.js";
import type { CheckResult } from "../types.js";

const PACKAGE_CHECK_CONCURRENCY = 8;

/** Installed packages apt can upgrade, from `apt list --upgradable`. */
const upgradablePackages = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const output = yield* executor
    .run("apt", ["list", "--upgradable"])
    .pipe(Effect.orElseSucceed(() => ""));

  return new Set(
    output
      .split("\n")
      .filter((line) => line.includes("/"))
      .map((line) => line.slice(0, line.indexOf("/"))),
  );
});

/**
 * Report whether each package is installed and current, ending with one
 * install command for every missing or outdated package.
 */
const packageListResults = Effect.fn("Packages.packageListResults")(function* (
  packages: readonly string[],
) {
  const results: CheckResult[] = [];
  const upgradable = yield* upgradablePackages;

  const checked = yield* Effect.forEach(
    packages,
    (pkg) =>
      isPackageInstalled(pkg).pipe(
        Effect.map((installed) => ({ pkg, installed })),
      ),
    { concurrency: PACKAGE_CHECK_CONCURRENCY },
  );

  const pending: string[] = [];

  for (const { pkg, installed } of checked) {
    if (!installed) {
      results.push({ severity: "warn", message: `${pkg} is missing` });
      pending.push(pkg);
      continue;
    }

    results.push({ severity: "ok", message: `${pkg} is installed` });

    if (upgradable.has(pkg)) {
      results.push({ severity: "warn", message: `${pkg} has an update` });
      pending.push(pkg);
    }
  }

  if (pending.length > 0)
    results.push({
      severity: "warn",
      message: `Install/update with: sudo apt-get install ${pending.join(" ")}`,
    });

  return results;
});

/** Check public apt packages are installed and up to date. */
export const checkPublicPackages = Effect.gen(function* () {
  const config = yield* Config;

  const packages = loadPackageList(
    envString(ENV.DOT_PUBLIC_PACKAGES_FILE) ??
      join(config.publicDotfiles, ".dot-public-packages"),
  );

  if (packages.length === 0) {
    return [
      { severity: "warn", message: "Could not load public packages file" },
    ] satisfies CheckResult[];
  }

  return yield* packageListResults(packages);
});

/** Check private apt packages are installed and up to date. */
export const checkPrivatePackages = Effect.gen(function* () {
  const config = yield* Config;

  if (!config.canUsePrivate) {
    return [
      {
        severity: "warn",
        message: `Skipping private package checks (${config.privateReason})`,
      },
    ] satisfies CheckResult[];
  }

  const packagesOverride = envString(ENV.DOT_PRIVATE_PACKAGES_FILE);

  const packagesFile =
    packagesOverride ??
    (config.privateDotfiles
      ? join(config.privateDotfiles, ".dot-private-packages")
      : null);

  if (!packagesFile || !(yield* pathExists(packagesFile))) {
    return [
      {
        severity: "warn",
        message: `Missing private package list: ${displayPath(packagesFile ?? "")}`,
      },
    ] satisfies CheckResult[];
  }

  const packages = loadPackageLists([
    packagesFile,
    ...(packagesOverride ? [] : [`${packagesFile}--${hostname()}`]),
  ]);

  if (packages.length === 0) {
    return [
      { severity: "ok", message: "No private packages configured" },
    ] satisfies CheckResult[];
  }

  return yield* packageListResults(packages);
});
